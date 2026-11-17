import { randomUUID } from 'node:crypto';
import { DEVICES, DEVICE_STATUS, TASKS, TASK_RESULTS, TASK_STATUS, pruneTaskRecords, writeAudit } from './database.js';
import { broadcastTaskUpdate, isAgentOnline, sendCommand } from './connection-hub.js';
import { nowIso } from './tokens.js';

export const MAX_CONCURRENT_DISPATCH = 10;
export const UPGRADE_TIMEOUT_SECONDS = 300;
export const MAX_OUTPUT_CHARS = 100_000;

const SYSINFO_FIELDS = [
  'cpu_model',
  'cpu_cores',
  'memory_total_mb',
  'disk_total_gb',
  'disk_free_gb',
  'os_version',
  'serial_number',
  'mac_address',
  'manufacturer',
  'model'
];

export function storeSysinfoOutput(db, deviceId, output) {
  let info;
  try {
    info = JSON.parse(output);
  } catch {
    return;
  }
  if (!info || typeof info !== 'object' || Array.isArray(info)) return;
  const values = {};
  for (const field of SYSINFO_FIELDS) {
    if (info[field] !== undefined && info[field] !== null) values[field] = info[field];
  }
  if (!Object.keys(values).length) return;
  const assignments = Object.keys(values).map(key => `${key} = ?`);
  assignments.push('sysinfo_updated_at = ?');
  db.prepare(`UPDATE ${DEVICES} SET ${assignments.join(', ')} WHERE id = ?`)
    .run(...Object.values(values), nowIso(), deviceId);
}

// 契约 #7：父任务终态聚合。全 success → COMPLETED；cancelled（可含 success）→ CANCELLED；其余 → FAILED
export function syncParentTask(db, taskId) {
  const rows = db.prepare(`SELECT status FROM ${TASK_RESULTS} WHERE task_id = ?`).all(taskId);
  if (!rows.length) return;
  const statuses = new Set(rows.map(row => row.status));
  if (statuses.has('pending') || statuses.has('sent') || statuses.has('running')) return;

  let final;
  if (statuses.size === 1 && statuses.has('success')) final = TASK_STATUS.COMPLETED;
  else if (statuses.has('cancelled') && [...statuses].every(s => s === 'cancelled' || s === 'success')) final = TASK_STATUS.CANCELLED;
  else final = TASK_STATUS.FAILED;

  db.prepare(`UPDATE ${TASKS} SET status = ?, finished_at = ? WHERE id = ? AND status != ?`)
    .run(final, nowIso(), taskId, TASK_STATUS.CANCELLED);
}

export function recordAgentResult(db, { deviceId, commandId, status, output }) {
  const row = db.prepare(`SELECT * FROM ${TASK_RESULTS} WHERE command_id = ?`).get(String(commandId));
  if (!row) return null;
  const text = typeof output === 'string' ? output : output == null ? '' : JSON.stringify(output);
  const clipped = text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated, total ${text.length} chars]`
    : text;
  db.prepare(
    `UPDATE ${TASK_RESULTS} SET status = ?, output = ?, finished_at = ?, updated_at = ? WHERE id = ?`
  ).run(status || 'unknown', clipped || null, nowIso(), nowIso(), row.id);

  if (status === 'success' && clipped) {
    const taskType = db.prepare(`SELECT task_type FROM ${TASKS} WHERE id = ?`).get(row.task_id)?.task_type;
    if (taskType === 'SYSINFO') storeSysinfoOutput(db, deviceId, clipped);
  }
  syncParentTask(db, row.task_id);
  broadcastTaskUpdate(row.task_id, {
    type: 'result',
    command_id: commandId,
    device_id: deviceId,
    status,
    output: clipped
  });
  return db.prepare(`SELECT * FROM ${TASK_RESULTS} WHERE id = ?`).get(row.id);
}

export function createTask(db, { taskType, deviceIds, params, operator, sourceIp }) {
  const now = nowIso();
  const existing = new Set(
    db.prepare(`SELECT id FROM ${DEVICES} WHERE deleted_at IS NULL AND id IN (${deviceIds.map(() => '?').join(',') || 'NULL'})`)
      .all(...deviceIds)
      .map(row => row.id)
  );
  const valid = deviceIds.filter(id => existing.has(Number(id)));
  const skipped = deviceIds.filter(id => !existing.has(Number(id)));

  const info = db.prepare(
    `INSERT INTO ${TASKS} (task_type, target_count, status, payload, created_by, created_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    taskType,
    valid.length,
    TASK_STATUS.RUNNING,
    params ? JSON.stringify(params) : null,
    operator ?? 'local-user',
    now,
    skipped.length ? `跳过不存在设备：${skipped.join(',')}` : null
  );
  const taskId = Number(info.lastInsertRowid);

  const insertResult = db.prepare(
    `INSERT INTO ${TASK_RESULTS} (task_id, device_id, command_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  );
  const commandIds = [];
  db.transaction(() => {
    for (const deviceId of valid) {
      const commandId = randomUUID();
      insertResult.run(taskId, deviceId, commandId, now, now);
      commandIds.push({ deviceId, commandId });
    }
  })();

  let sent = 0;
  for (const { deviceId, commandId } of commandIds) {
    const delivered = sendCommand(deviceId, {
      id: commandId,
      action: taskType,
      params: params ?? {}
    });
    if (delivered) {
      sent += 1;
      db.prepare(
        `UPDATE ${TASK_RESULTS} SET status = 'sent', started_at = ?, updated_at = ? WHERE command_id = ?`
      ).run(now, now, commandId);
    }
  }

  // 未送达的子任务保持 pending：设备上线后由 dispatchPendingCommands 补发，
  // 期间任务处于 DISPATCHED，可以正常取消。

  const pendingLeft = db
    .prepare(`SELECT COUNT(*) AS total FROM ${TASK_RESULTS} WHERE task_id = ? AND status = 'pending'`)
    .get(taskId).total;

  if (!valid.length) {
    db.prepare(`UPDATE ${TASKS} SET status = ?, finished_at = ? WHERE id = ?`).run(TASK_STATUS.FAILED, now, taskId);
  } else if (pendingLeft > 0) {
    db.prepare(`UPDATE ${TASKS} SET status = ? WHERE id = ?`).run(TASK_STATUS.DISPATCHED, taskId);
  } else {
    syncParentTask(db, taskId);
  }

  writeAudit({
    action: 'task.create',
    taskId,
    detail: `${taskType} → ${valid.length} 台${skipped.length ? `，跳过 ${skipped.length} 台` : ''}`,
    sourceIp
  });
  pruneTaskRecords(db);
  return taskId;
}

export function dispatchPendingCommands(db, deviceId) {
  const rows = db.prepare(
    `SELECT r.command_id, r.task_id, t.task_type, t.payload
     FROM ${TASK_RESULTS} r JOIN ${TASKS} t ON t.id = r.task_id
     WHERE r.device_id = ? AND r.status = 'pending' ORDER BY r.id ASC`
  ).all(deviceId);
  if (!rows.length) return 0;
  const now = nowIso();
  let sent = 0;
  for (const row of rows) {
    const ok = sendCommand(deviceId, {
      id: row.command_id,
      action: row.task_type,
      params: row.payload ? JSON.parse(row.payload) : {}
    });
    if (!ok) break;
    db.prepare(`UPDATE ${TASK_RESULTS} SET status = 'sent', started_at = ?, updated_at = ? WHERE command_id = ?`)
      .run(now, now, row.command_id);
    sent += 1;
  }
  return sent;
}

export function cancelTask(db, taskId, sourceIp) {
  const task = db.prepare(`SELECT * FROM ${TASKS} WHERE id = ?`).get(taskId);
  if (!task) return { ok: false, reason: '任务不存在' };
  if (![TASK_STATUS.PENDING, TASK_STATUS.RUNNING, TASK_STATUS.DISPATCHED].includes(task.status)) {
    return { ok: false, reason: '任务已结束，无法取消' };
  }
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `UPDATE ${TASK_RESULTS} SET status = 'cancelled', finished_at = ?, updated_at = ?
       WHERE task_id = ? AND status IN ('pending','sent','running')`
    ).run(now, now, taskId);
    db.prepare(`UPDATE ${TASKS} SET status = ?, finished_at = ? WHERE id = ?`)
      .run(TASK_STATUS.CANCELLED, now, taskId);
  })();
  writeAudit({ action: 'task.cancel', taskId, sourceIp });
  return { ok: true };
}

export function applyUpgradeTimeout(db, taskId) {
  const task = db.prepare(`SELECT * FROM ${TASKS} WHERE id = ?`).get(taskId);
  if (!task || task.task_type !== 'UPGRADE') return false;
  if (![TASK_STATUS.RUNNING, TASK_STATUS.DISPATCHED].includes(task.status)) return false;
  const cutoff = Date.now() - UPGRADE_TIMEOUT_SECONDS * 1000;
  const rows = db.prepare(
    `SELECT id, status, started_at FROM ${TASK_RESULTS} WHERE task_id = ? AND status IN ('sent','running','pending')`
  ).all(taskId);
  const stale = rows.filter(row => {
    const started = row.started_at ? Date.parse(row.started_at) : Date.parse(task.created_at);
    return !Number.isNaN(started) && started < cutoff;
  });
  if (!stale.length) return false;
  const now = nowIso();
  db.transaction(() => {
    for (const row of stale) {
      db.prepare(
        `UPDATE ${TASK_RESULTS} SET status = 'timeout', output = ?, finished_at = ?, updated_at = ? WHERE id = ?`
      ).run('升级超时：Agent 未在 5 分钟内回报结果', now, now, row.id);
    }
    db.prepare(`UPDATE ${TASKS} SET status = ?, finished_at = ? WHERE id = ?`).run(TASK_STATUS.FAILED, now, taskId);
  })();
  broadcastTaskUpdate(taskId, { type: 'timeout', task_id: taskId });
  return true;
}

export function isOnlineNow(deviceId) {
  return isAgentOnline(deviceId);
}

export function markOfflineIfDisconnected(db, deviceId) {
  if (isAgentOnline(deviceId)) return false;
  db.prepare(`UPDATE ${DEVICES} SET status = ?, updated_at = ? WHERE id = ?`)
    .run(DEVICE_STATUS.OFFLINE, nowIso(), deviceId);
  return true;
}
