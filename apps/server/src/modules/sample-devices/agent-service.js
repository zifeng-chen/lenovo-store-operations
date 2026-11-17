import { DEVICES, DEVICE_STATUS, TASK_RESULTS, TASKS, TASK_STATUS, writeAudit } from './database.js';
import { generateToken, pickDeviceToken, safeText, secondsSince, tokensEqual } from './tokens.js';

const HEARTBEAT_DEVICE_FIELDS = [
  'hostname',
  'ip',
  'os_info',
  'agent_version',
  'cpu_model',
  'cpu_cores',
  'memory_total_mb',
  'disk_total_gb',
  'disk_free_gb',
  'os_version',
  'serial_number',
  'mac_address',
  'manufacturer',
  'model',
  'rearm_count',
  'group_name'
];

// 只有真实可路由的局域网地址才值得写进设备记录。
// Agent 多网卡时可能误报回环/链路本地地址，这类地址不能覆盖已知的有效 IP。
function isUsableDeviceIp(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  if (!parts.every(part => /^\d{1,3}$/.test(part))) return false;
  const bytes = parts.map(Number);
  if (bytes.some(byte => byte > 255)) return false;
  if (bytes[0] === 127) return false;
  if (bytes[0] === 169 && bytes[1] === 254) return false;
  if (bytes.every(byte => byte === 0)) return false;
  return true;
}

function pickHeartbeatFields(payload, existing) {
  const source = payload?.device ?? payload?.info ?? payload ?? {};
  const result = {};
  for (const field of HEARTBEAT_DEVICE_FIELDS) {
    const value = source[field] ?? payload?.[field];
    if (value === undefined || value === null || value === '') continue;
    if (field === 'hostname' && existing?.hostname_locked) continue;
    // ip 单独处理：Agent 多网卡时可能报回环或链路本地地址，不可用就丢弃
    if (field === 'ip') {
      if (isUsableDeviceIp(value)) result.ip = String(value).trim();
      continue;
    }
    result[field] = typeof value === 'string' ? safeText(value, 512) : value;
  }
  return result;
}

function findByDeviceId(db, deviceId) {
  if (deviceId == null || deviceId === '') return null;
  const numeric = Number(deviceId);
  if (Number.isInteger(numeric) && numeric > 0) {
    const byId = db.prepare(`SELECT * FROM ${DEVICES} WHERE id = ?`).get(numeric);
    if (byId) return byId;
  }
  const text = String(deviceId);
  return db
    .prepare(
      `SELECT * FROM ${DEVICES}
       WHERE token = ? OR serial_number = ? OR mac_address = ?
       ORDER BY last_heartbeat DESC LIMIT 1`
    )
    .get(text, text, text) ?? null;
}

// 契约 #2：device_id 精确匹配 → ip 兜底（取最近心跳）
function resolveDevice(db, { deviceId, ip, token }) {
  const direct = findByDeviceId(db, deviceId);
  if (direct) {
    return { device: direct, outcome: tokensEqual(direct.token, token) ? 'matched' : 'token-mismatch' };
  }
  if (ip) {
    const byIp = db
      .prepare(`SELECT * FROM ${DEVICES} WHERE ip = ? ORDER BY last_heartbeat DESC LIMIT 1`)
      .get(ip);
    if (byIp) {
      return { device: byIp, outcome: tokensEqual(byIp.token, token) ? 'ip-fallback' : 'token-mismatch' };
    }
  }
  return { device: null, outcome: 'unknown' };
}

function adoptDevice(db, device, { token, fields, ip }) {
  const now = new Date().toISOString();
  const nextToken = token || generateToken();
  const assignments = ['token = ?', 'status = ?', 'last_heartbeat = ?', 'updated_at = ?', 'deleted_at = NULL'];
  const values = [nextToken, DEVICE_STATUS.ONLINE, now, now];
  for (const [key, value] of Object.entries(fields)) {
    // ip 在下面单独合并，避免同一条 UPDATE 里出现两次赋值
    if (key === 'ip') continue;
    assignments.push(`${key} = ?`);
    values.push(value);
  }
  const nextIp = isUsableDeviceIp(fields.ip) ? fields.ip : (isUsableDeviceIp(ip) ? ip : null);
  if (nextIp) {
    assignments.push('ip = ?');
    values.push(nextIp);
  }
  values.push(device.id);
  db.prepare(`UPDATE ${DEVICES} SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare(`SELECT * FROM ${DEVICES} WHERE id = ?`).get(device.id);
}

export function createRegistrationLock() {
  let chain = Promise.resolve();
  return function runLocked(task) {
    const result = chain.then(task, task);
    chain = result.catch(() => {});
    return result;
  };
}

export function pendingCommandsFor(db, deviceId) {
  return db
    .prepare(
      `SELECT r.id, r.task_id, r.command_id, t.task_type
       FROM ${TASK_RESULTS} r
       JOIN ${TASKS} t ON t.id = r.task_id
       WHERE r.device_id = ? AND r.status = 'pending'
       ORDER BY r.id ASC`
    )
    .all(deviceId)
    .map(row => ({
      command_id: row.command_id,
      task_id: row.task_id,
      task_type: row.task_type,
      payload: db.prepare(`SELECT payload FROM ${TASKS} WHERE id = ?`).get(row.task_id)?.payload ?? null
    }));
}

export function handleHeartbeat(db, { payload, ip, agentToken, enrollValid }) {
  const deviceId = payload?.device_id ?? payload?.deviceId ?? null;
  const registrationToken = pickDeviceToken(payload) || agentToken || '';
  const resolved = resolveDevice(db, { deviceId, ip, token: registrationToken });
  const now = new Date().toISOString();

  if (!resolved.device) {
    // 未知设备首次注册：必须携带预共享注册密钥，防止匿名伪造设备
    if (!enrollValid) {
      writeAudit({ action: 'heartbeat.rejected', detail: '未登记设备且无有效注册密钥', sourceIp: ip });
      return { status: 401, body: { code: 1, data: null, msg: '设备未登记' } };
    }
    const fields = pickHeartbeatFields(payload, null);
    const creation = db.prepare(
      `INSERT INTO ${DEVICES} (hostname, hostname_locked, ip, os_info, status, group_name, rearm_count, agent_version,
        cpu_model, cpu_cores, memory_total_mb, disk_total_gb, disk_free_gb, os_version,
        serial_number, mac_address, manufacturer, model, sysinfo_updated_at,
        token, last_heartbeat, created_at, updated_at)
       VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      fields.hostname ?? null,
      isUsableDeviceIp(fields.ip) ? fields.ip : ip,
      fields.os_info ?? null,
      DEVICE_STATUS.ONLINE,
      fields.group_name ?? null,
      Number(fields.rearm_count ?? 0),
      fields.agent_version ?? null,
      fields.cpu_model ?? null,
      fields.cpu_cores ?? null,
      fields.memory_total_mb ?? null,
      fields.disk_total_gb ?? null,
      fields.disk_free_gb ?? null,
      fields.os_version ?? null,
      fields.serial_number ?? null,
      fields.mac_address ?? null,
      fields.manufacturer ?? null,
      fields.model ?? null,
      fields.cpu_model || fields.serial_number ? now : null,
      registrationToken || generateToken(),
      now,
      now,
      now
    );
    const createdId = Number(creation.lastInsertRowid);
    writeAudit({
      action: 'device.enrolled',
      deviceId: createdId,
      detail: `${fields.hostname ?? ''} / ${ip ?? ''} 首次注册`,
      sourceIp: ip
    });
    const created = db.prepare(`SELECT * FROM ${DEVICES} WHERE id = ?`).get(createdId);
    return {
      status: 200,
      body: {
        code: 0,
        data: {
          action: 'created',
          device_id: createdId,
          token: created.token,
          commands: []
        },
        msg: 'success'
      }
    };
  }

  const device = resolved.device;

  if (resolved.outcome === 'token-mismatch') {
    if (device.deleted_at && !enrollValid) {
      return { status: 200, body: { code: 0, data: { action: 'deleted', device_id: device.id }, msg: 'success' } };
    }
    if (!enrollValid) {
      writeAudit({ action: 'heartbeat.rejected', deviceId: device.id, detail: '令牌不一致', sourceIp: ip });
      return { status: 401, body: { code: 1, data: null, msg: '设备令牌无效' } };
    }
    const fields = pickHeartbeatFields(payload, device);
    const adopted = adoptDevice(db, device, { token: registrationToken, fields, ip });
    writeAudit({
      action: 'device.re-enrolled',
      deviceId: adopted.id,
      detail: device.deleted_at ? '已删除设备重新接入' : '令牌轮换后收养',
      sourceIp: ip
    });
    return {
      status: 200,
      body: {
        code: 0,
        data: {
          action: 're-enrolled',
          device_id: adopted.id,
          token: adopted.token,
          commands: pendingCommandsFor(db, adopted.id)
        },
        msg: 'success'
      }
    };
  }

  if (device.deleted_at) {
    return { status: 200, body: { code: 0, data: { action: 'deleted', device_id: device.id }, msg: 'success' } };
  }

  const fields = pickHeartbeatFields(payload, device);
  const assignments = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    // ip 在下面单独合并，避免同一条 UPDATE 里出现两次赋值
    if (key === 'ip') continue;
    assignments.push(`${key} = ?`);
    values.push(value);
  }
  assignments.push('status = ?', 'last_heartbeat = ?', 'updated_at = ?');
  values.push(DEVICE_STATUS.ONLINE, now, now);
  // 网络恢复或换网后 Agent 会带上新地址，这里跟着更新，保证管理端显示的是当前真实 IP。
  // Agent 自报的地址优先（多网卡时更准确），无效时退回连接来源 IP。
  const reportedIp = isUsableDeviceIp(fields.ip) ? fields.ip : null;
  const nextIp = reportedIp ?? (isUsableDeviceIp(ip) ? ip : null);
  if (nextIp && nextIp !== device.ip) {
    assignments.push('ip = ?');
    values.push(nextIp);
  }
  values.push(device.id);
  db.prepare(`UPDATE ${DEVICES} SET ${assignments.join(', ')} WHERE id = ?`).run(...values);

  return {
    status: 200,
    body: {
      code: 0,
      data: {
        action: 'ok',
        device_id: device.id,
        token: device.token,
        commands: pendingCommandsFor(db, device.id)
      },
      msg: 'success'
    }
  };
}

export function refreshDeviceStatuses(db, onlineWindowSeconds) {
  const rows = db.prepare(`SELECT id, status, last_heartbeat FROM ${DEVICES} WHERE deleted_at IS NULL`).all();
  const update = db.prepare(`UPDATE ${DEVICES} SET status = ?, updated_at = ? WHERE id = ?`);
  const timestamp = new Date().toISOString();
  let changed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const age = secondsSince(row.last_heartbeat);
      const expected = age != null && age <= onlineWindowSeconds ? DEVICE_STATUS.ONLINE : DEVICE_STATUS.OFFLINE;
      if (row.status === expected) continue;
      update.run(expected, timestamp, row.id);
      changed += 1;
    }
  })();
  return changed;
}

export function markTaskDispatchState(db, taskId) {
  const rows = db.prepare(`SELECT status FROM ${TASK_RESULTS} WHERE task_id = ?`).all(taskId);
  if (!rows.length) return TASK_STATUS.PENDING;
  if (rows.some(row => row.status === 'pending')) return TASK_STATUS.DISPATCHED;
  return TASK_STATUS.RUNNING;
}
