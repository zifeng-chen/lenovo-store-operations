import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { isPortableExecutable, MAX_UPLOAD_BYTES } from './upload-store.js';
import {
  AUDIT_LOGS,
  DEVICES,
  DEVICE_STATUS,
  TASK_RESULTS,
  TASKS,
  TASK_TYPES,
  writeAudit
} from './database.js';
import { applyUpgradeTimeout, cancelTask, createTask } from './task-service.js';
import { isAgentOnline, sendCommand } from './connection-hub.js';
import { randomUUID } from 'node:crypto';
import { nowIso, safeText } from './tokens.js';

const TASK_LABELS = {
  SYSPREP: 'Sysprep 关机',
  SYSPREP_REBOOT: 'Sysprep 重启',
  SHUTDOWN: '关机',
  REBOOT: '重启',
  STATUS: '状态检查',
  UPGRADE: '远程升级',
  FILE_PUSH: '文件分发',
  HOSTMSG: '弹窗提示',
  SYSINFO: '采集设备信息',
  RESET_PWD: '清空账户密码'
};

const TASK_TYPE_ALIASES = new Map();
for (const type of TASK_TYPES) {
  TASK_TYPE_ALIASES.set(type, type);
  TASK_TYPE_ALIASES.set(type.toLowerCase(), type);
}

function normalizeTaskType(input) {
  return TASK_TYPE_ALIASES.get(String(input ?? '').trim()) ?? null;
}

function ipSortKey(device) {
  const text = String(device.ip ?? '');
  const parts = text.split('.');
  if (parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part))) {
    return [0, parts.reduce((acc, part) => acc * 256 + Number(part), 0), device.hostname ?? ''];
  }
  return [1, 0, device.hostname ?? ''];
}

function describeTask(taskType, params) {
  if (taskType === 'UPGRADE') return `升级到 v${params?.version ?? '?'}`;
  if (taskType === 'FILE_PUSH') return `分发文件 ${params?.filename ?? ''}`.trim();
  return TASK_LABELS[taskType] ?? taskType;
}

function serializeDevice(row) {
  return {
    id: row.id,
    hostname: row.hostname,
    hostname_locked: Boolean(row.hostname_locked),
    ip: row.ip,
    os_info: row.os_info,
    status: row.status === DEVICE_STATUS.ONLINE ? 'online' : 'offline',
    raw_status: row.status,
    group_name: row.group_name,
    rearm_count: row.rearm_count,
    agent_version: row.agent_version,
    last_heartbeat: row.last_heartbeat,
    created_at: row.created_at,
    cpu_model: row.cpu_model,
    cpu_cores: row.cpu_cores,
    memory_total_mb: row.memory_total_mb,
    disk_total_gb: row.disk_total_gb,
    disk_free_gb: row.disk_free_gb,
    os_version: row.os_version,
    serial_number: row.serial_number,
    mac_address: row.mac_address,
    manufacturer: row.manufacturer,
    model: row.model,
    sysinfo_updated_at: row.sysinfo_updated_at,
    socket_connected: isAgentOnline(row.id),
    deleted_at: row.deleted_at
  };
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const candidate = (raw ? String(raw).split(',')[0] : req.socket?.remoteAddress) || '';
  return candidate.replace(/^::ffff:/, '').trim() || null;
}

function bodyDeviceIds(body) {
  const list = Array.isArray(body?.device_ids) ? body.device_ids : [];
  return list.map(Number).filter(id => Number.isInteger(id) && id > 0);
}

export function createManagementRouter({ getDb, resolveServerUrl, resolveAgentServerUrl, enrollSecret, uploads }) {
  const router = Router();
  const ok = (res, data, msg = 'success') => res.json({ code: 0, data, msg });
  const fail = (res, status, msg) => res.status(status).json({ code: 1, data: null, msg });

  router.get('/devices', (req, res) => {
    const db = getDb();
    const { status, group, search } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(5000, Math.max(1, Number(req.query.size) || 500));

    const clauses = ['deleted_at IS NULL'];
    const params = [];
    if (status === 'online' || status === DEVICE_STATUS.ONLINE) {
      clauses.push('status = ?');
      params.push(DEVICE_STATUS.ONLINE);
    } else if (status === 'offline' || status === DEVICE_STATUS.OFFLINE) {
      clauses.push('status = ?');
      params.push(DEVICE_STATUS.OFFLINE);
    }
    if (group) {
      clauses.push('group_name = ?');
      params.push(String(group));
    }
    if (search) {
      clauses.push('(LOWER(hostname) LIKE ? OR ip LIKE ? OR LOWER(serial_number) LIKE ?)');
      const like = `%${String(search).toLowerCase()}%`;
      params.push(like, `%${search}%`, like);
    }
    const rows = db.prepare(`SELECT * FROM ${DEVICES} WHERE ${clauses.join(' AND ')}`).all(...params);
    rows.sort((a, b) => {
      const [ka, va, ha] = ipSortKey(a);
      const [kb, vb, hb] = ipSortKey(b);
      if (ka !== kb) return ka - kb;
      if (va !== vb) return va - vb;
      return String(ha).localeCompare(String(hb));
    });
    const start = (page - 1) * size;
    ok(res, rows.slice(start, start + size).map(serializeDevice));
  });

  router.get('/devices/stats', (_req, res) => {
    const db = getDb();
    const base = `deleted_at IS NULL`;
    const total = db.prepare(`SELECT COUNT(*) AS total FROM ${DEVICES} WHERE ${base}`).get().total;
    const online = db.prepare(`SELECT COUNT(*) AS total FROM ${DEVICES} WHERE ${base} AND status = ?`).get(DEVICE_STATUS.ONLINE).total;
    ok(res, { total, online, offline: total - online });
  });

  router.get('/devices/groups', (_req, res) => {
    const rows = getDb()
      .prepare(`SELECT DISTINCT group_name FROM ${DEVICES} WHERE deleted_at IS NULL AND group_name IS NOT NULL ORDER BY group_name`)
      .all();
    ok(res, rows.map(row => row.group_name));
  });

  router.post('/devices', (req, res) => {
    const db = getDb();
    const hostname = safeText(req.body?.hostname, 255);
    const ip = safeText(req.body?.ip, 45);
    const groupName = safeText(req.body?.group_name, 100);
    const info = db.prepare(
      `INSERT INTO ${DEVICES} (hostname, ip, group_name, token, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(hostname, ip, groupName, randomUUID(), DEVICE_STATUS.OFFLINE, nowIso(), nowIso());
    writeAudit({ action: 'device.create', deviceId: Number(info.lastInsertRowid), sourceIp: clientIp(req) });
    ok(res, serializeDevice(db.prepare(`SELECT * FROM ${DEVICES} WHERE id = ?`).get(Number(info.lastInsertRowid))));
  });

  router.put('/devices/:deviceId', (req, res) => {
    const db = getDb();
    const deviceId = Number(req.params.deviceId);
    const device = db.prepare(`SELECT * FROM ${DEVICES} WHERE id = ?`).get(deviceId);
    if (!device) return fail(res, 404, '设备不存在');

    const assignments = [];
    const values = [];
    if (req.body?.hostname !== undefined) {
      assignments.push('hostname = ?', 'hostname_locked = 1');
      values.push(safeText(req.body.hostname, 255));
    }
    if (req.body?.ip !== undefined) {
      assignments.push('ip = ?');
      values.push(safeText(req.body.ip, 45));
    }
    if (req.body?.group_name !== undefined) {
      assignments.push('group_name = ?');
      values.push(safeText(req.body.group_name, 100));
    }
    if (!assignments.length) return fail(res, 400, '没有需要更新的字段');
    assignments.push('updated_at = ?');
    values.push(nowIso(), deviceId);
    db.prepare(`UPDATE ${DEVICES} SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    writeAudit({ action: 'device.update', deviceId, sourceIp: clientIp(req) });
    ok(res, serializeDevice(db.prepare(`SELECT * FROM ${DEVICES} WHERE id = ?`).get(deviceId)));
  });

  router.delete('/devices/:deviceId', (req, res) => {
    const db = getDb();
    const deviceId = Number(req.params.deviceId);
    const device = db.prepare(`SELECT * FROM ${DEVICES} WHERE id = ?`).get(deviceId);
    if (!device) return fail(res, 404, '设备不存在');

    let uninstallSent = false;
    if (isAgentOnline(deviceId)) {
      uninstallSent = sendCommand(deviceId, { id: randomUUID(), action: 'uninstall', params: {} });
    }
    db.prepare(`UPDATE ${DEVICES} SET deleted_at = ?, status = ?, updated_at = ? WHERE id = ?`)
      .run(nowIso(), DEVICE_STATUS.OFFLINE, nowIso(), deviceId);
    writeAudit({ action: 'device.delete', deviceId, detail: `uninstall_sent=${uninstallSent}`, sourceIp: clientIp(req) });
    ok(res, { status: 'deleted', uninstall_sent: uninstallSent });
  });

  router.post('/devices/batch-delete', (req, res) => {
    const db = getDb();
    const ids = bodyDeviceIds(req.body);
    if (!ids.length) return fail(res, 400, '未指定设备');
    let uninstallSent = 0;
    let deleted = 0;
    db.transaction(() => {
      for (const id of ids) {
        const device = db.prepare(`SELECT id FROM ${DEVICES} WHERE id = ?`).get(id);
        if (!device) continue;
        if (isAgentOnline(id) && sendCommand(id, { id: randomUUID(), action: 'uninstall', params: {} })) {
          uninstallSent += 1;
        }
        db.prepare(`UPDATE ${DEVICES} SET deleted_at = ?, status = ?, updated_at = ? WHERE id = ?`)
          .run(nowIso(), DEVICE_STATUS.OFFLINE, nowIso(), id);
        deleted += 1;
      }
    })();
    writeAudit({ action: 'device.batch-delete', detail: `deleted=${deleted}, uninstall_sent=${uninstallSent}`, sourceIp: clientIp(req) });
    ok(res, { deleted, requested: ids.length, uninstall_sent: uninstallSent });
  });

  router.post('/devices/batch-group', (req, res) => {
    const db = getDb();
    const ids = bodyDeviceIds(req.body);
    const groupName = safeText(req.body?.group_name, 100);
    if (!ids.length) return fail(res, 400, '未指定设备');
    const update = db.prepare(`UPDATE ${DEVICES} SET group_name = ?, updated_at = ? WHERE id = ?`);
    db.transaction(() => {
      for (const id of ids) update.run(groupName, nowIso(), id);
    })();
    writeAudit({ action: 'device.batch-group', detail: `group=${groupName ?? ''}, count=${ids.length}`, sourceIp: clientIp(req) });
    ok(res, { updated: ids.length, group_name: groupName });
  });

  router.post('/devices/import/ip-range', (req, res) => {
    const db = getDb();
    const startIp = String(req.body?.start_ip ?? '').trim();
    const endIp = String(req.body?.end_ip ?? '').trim();
    const groupName = safeText(req.body?.group_name, 100);
    const toInt = ip => {
      const parts = ip.split('.');
      if (parts.length !== 4 || !parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
      return parts.reduce((acc, p) => acc * 256 + Number(p), 0);
    };
    const start = toInt(startIp);
    const end = toInt(endIp);
    if (start == null || end == null) return fail(res, 400, 'IP 地址格式无效');
    if (end < start) return fail(res, 400, '结束 IP 不能小于起始 IP');
    if (end - start > 1024) return fail(res, 400, 'IP 段过大（最多 1024 个）');

    const fromInt = value => [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');
    const existing = new Set(db.prepare(`SELECT ip FROM ${DEVICES} WHERE ip IS NOT NULL`).all().map(row => row.ip));
    const insert = db.prepare(
      `INSERT INTO ${DEVICES} (ip, group_name, token, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    let added = 0;
    let skipped = 0;
    db.transaction(() => {
      for (let value = start; value <= end; value += 1) {
        const ip = fromInt(value);
        if (existing.has(ip)) {
          skipped += 1;
          continue;
        }
        insert.run(ip, groupName, randomUUID(), DEVICE_STATUS.OFFLINE, nowIso(), nowIso());
        added += 1;
      }
    })();
    writeAudit({ action: 'device.import-ip-range', detail: `${startIp}-${endIp} added=${added}`, sourceIp: clientIp(req) });
    ok(res, { added, skipped });
  });

  router.post('/devices/import/csv', (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const fallbackGroup = safeText(req.body?.group_name, 100);
    if (!rows.length) return fail(res, 400, 'CSV 内容为空');
    const db = getDb();
    const existing = new Set(db.prepare(`SELECT ip FROM ${DEVICES} WHERE ip IS NOT NULL`).all().map(row => row.ip));
    const insert = db.prepare(
      `INSERT INTO ${DEVICES} (hostname, ip, group_name, token, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    let added = 0;
    let skipped = 0;
    const errors = [];
    db.transaction(() => {
      rows.forEach((row, index) => {
        const ip = safeText(row.ip, 45);
        if (!ip) {
          errors.push(`第 ${index + 2} 行：缺少 ip`);
          return;
        }
        if (existing.has(ip)) {
          skipped += 1;
          return;
        }
        insert.run(
          safeText(row.hostname, 255),
          ip,
          safeText(row.group, 100) ?? fallbackGroup,
          randomUUID(),
          DEVICE_STATUS.OFFLINE,
          nowIso(),
          nowIso()
        );
        existing.add(ip);
        added += 1;
      });
    })();
    writeAudit({ action: 'device.import-csv', detail: `added=${added}, skipped=${skipped}`, sourceIp: clientIp(req) });
    ok(res, { added, skipped, errors });
  });

  router.get('/tasks', (req, res) => {
    const db = getDb();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const tasks = db.prepare(`SELECT * FROM ${TASKS} ORDER BY created_at DESC LIMIT ?`).all(limit);
    const ipMap = new Map(db.prepare(`SELECT id, ip FROM ${DEVICES}`).all().map(row => [row.id, row.ip]));
    const resultRows = tasks.length
      ? db.prepare(
          `SELECT task_id, device_id FROM ${TASK_RESULTS} WHERE task_id IN (${tasks.map(() => '?').join(',')})`
        ).all(...tasks.map(task => task.id))
      : [];
    const byTask = new Map();
    for (const row of resultRows) {
      if (!byTask.has(row.task_id)) byTask.set(row.task_id, []);
      byTask.get(row.task_id).push(ipMap.get(row.device_id) ?? String(row.device_id));
    }
    ok(res, tasks.map(task => ({
      id: task.id,
      task_type: task.task_type,
      status: task.status,
      description: describeTask(task.task_type, task.payload ? JSON.parse(task.payload) : {}),
      device_ips: byTask.get(task.id) ?? [],
      target_count: task.target_count,
      created_by: task.created_by,
      created_at: task.created_at,
      finished_at: task.finished_at
    })));
  });

  router.get('/tasks/:taskId', (req, res) => {
    const db = getDb();
    const taskId = Number(req.params.taskId);
    applyUpgradeTimeout(db, taskId);
    const task = db.prepare(`SELECT * FROM ${TASKS} WHERE id = ?`).get(taskId);
    if (!task) return fail(res, 404, '任务不存在');
    const results = db.prepare(`SELECT * FROM ${TASK_RESULTS} WHERE task_id = ? ORDER BY id`).all(taskId);
    const ipMap = new Map(db.prepare(`SELECT id, ip, hostname FROM ${DEVICES}`).all().map(row => [row.id, row]));
    ok(res, {
      id: task.id,
      task_type: task.task_type,
      status: task.status,
      description: describeTask(task.task_type, task.payload ? JSON.parse(task.payload) : {}),
      params: task.payload,
      created_at: task.created_at,
      finished_at: task.finished_at,
      results: results.map(row => ({
        id: row.id,
        command_id: row.command_id,
        device_id: row.device_id,
        device_ip: ipMap.get(row.device_id)?.ip ?? String(row.device_id),
        device_hostname: ipMap.get(row.device_id)?.hostname ?? null,
        status: row.status,
        output: row.output,
        started_at: row.started_at,
        finished_at: row.finished_at
      }))
    });
  });

  router.post('/tasks', (req, res) => {
    const taskType = normalizeTaskType(req.body?.task_type);
    if (!taskType) return fail(res, 400, `不支持的任务类型：${req.body?.task_type ?? ''}`);
    const deviceIds = bodyDeviceIds(req.body);
    if (!deviceIds.length) return fail(res, 400, '请至少选择一台设备');
    const taskId = createTask(getDb(), {
      taskType,
      deviceIds,
      params: req.body?.params ?? null,
      operator: req.body?.operator ?? null,
      sourceIp: clientIp(req)
    });
    ok(res, { id: taskId, task_type: taskType });
  });

  router.post('/tasks/:taskId/cancel', (req, res) => {
    const result = cancelTask(getDb(), Number(req.params.taskId), clientIp(req));
    if (!result.ok) return fail(res, 400, result.reason);
    ok(res, { status: 'cancelled' });
  });

  router.get('/audit', (req, res) => {
    const db = getDb();
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(200, Math.max(1, Number(req.query.size) || 50));
    const action = safeText(req.query.action, 50);
    const clauses = [];
    const params = [];
    if (action) {
      clauses.push('action = ?');
      params.push(action);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS total FROM ${AUDIT_LOGS} ${where}`).get(...params).total;
    const rows = db.prepare(
      `SELECT * FROM ${AUDIT_LOGS} ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    ).all(...params, size, (page - 1) * size);
    ok(res, {
      total,
      page,
      size,
      items: rows.map(row => ({
        id: row.id,
        action: row.action,
        device_id: row.device_id,
        task_id: row.task_id,
        detail: row.detail,
        ip_address: row.source_ip,
        created_at: row.created_at
      }))
    });
  });

  router.get('/audit/actions', (_req, res) => {
    const rows = getDb().prepare(`SELECT DISTINCT action FROM ${AUDIT_LOGS} ORDER BY action`).all();
    ok(res, rows.map(row => row.action));
  });

  router.get('/health', (_req, res) => ok(res, { status: 'ok', module: 'sample-devices' }));

  router.get('/enroll-secret-configured', (_req, res) =>
    ok(res, { configured: Boolean(enrollSecret) })
  );

  router.get('/uploads', (_req, res) => ok(res, uploads.list()));

  router.post('/uploads/agent', multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }).single('file'), (req, res) => {
    if (!req.file) return fail(res, 400, '未收到文件');
    if (!/\.exe$/i.test(req.file.originalname || '')) return fail(res, 400, '仅支持 .exe 文件');
    if (!isPortableExecutable(req.file.buffer)) return fail(res, 400, '不是有效的 Windows PE 可执行文件');
    const filename = uploads.saveExe(req.file.buffer);
    writeAudit({ action: 'agent.upload', detail: `${filename} (${req.file.size} bytes)`, sourceIp: clientIp(req) });
    ok(res, { filename, size: req.file.size });
  });

  router.post('/uploads/file', multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }).single('file'), (req, res) => {
    if (!req.file) return fail(res, 400, '未收到文件');
    const saved = uploads.saveFile(req.file.buffer, req.file.originalname);
    writeAudit({ action: 'file.upload', detail: `${saved.filename} (${req.file.size} bytes)`, sourceIp: clientIp(req) });
    ok(res, { ...saved, size: req.file.size });
  });

  router.get('/uploads/download/:filename', (req, res) => {
    const target = uploads.resolve(req.params.filename);
    if (!target) return fail(res, 404, '文件不存在');
    res.download(target, path.basename(target));
  });

  router.get('/uploads/agent/latest', (_req, res) => {
    const latest = uploads.latestAgent();
    if (!latest) return fail(res, 404, '服务器上未找到 LanAgent.exe');
    res.set('Cache-Control', 'no-store');
    ok(res, { version: latest.version, size: latest.size });
  });

  router.get('/uploads/agent/latest/download', (_req, res) => {
    const latest = uploads.latestAgent();
    if (!latest) return fail(res, 404, '服务器上未找到 LanAgent.exe');
    res.download(latest.path, 'LanAgent.exe');
  });

  router.get('/deploy/server-url', (req, res) => {
    try {
      ok(res, { server_url: resolveServerUrl(req).serverUrl });
    } catch (error) {
      fail(res, 500, error.message);
    }
  });

  router.post('/deploy/generate-token', (req, res) => {
    const db = getDb();
    const hostname = safeText(req.body?.hostname, 255);
    const ip = safeText(req.body?.ip, 45);
    const groupName = safeText(req.body?.group_name, 100);
    const token = randomUUID();
    const info = db.prepare(
      `INSERT INTO ${DEVICES} (hostname, ip, group_name, token, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(hostname, ip, groupName, token, DEVICE_STATUS.OFFLINE, nowIso(), nowIso());
    writeAudit({ action: 'device.create', deviceId: Number(info.lastInsertRowid), detail: 'via 部署包', sourceIp: clientIp(req) });
    ok(res, { device_id: Number(info.lastInsertRowid), token, hostname, ip });
  });

  router.post('/deploy/package', (req, res) => {
    if (!enrollSecret) return fail(res, 500, '未配置注册密钥，无法生成部署包');
    let serverUrl;
    try {
      // 部署包内配置的是 Agent 要连的地址，必须是 Agent 契约端口。
      serverUrl = resolveAgentServerUrl(req).serverUrl;
    } catch (error) {
      return fail(res, 500, error.message);
    }
    let buffer;
    try {
      buffer = uploads.buildPackage(serverUrl, enrollSecret);
    } catch (error) {
      return fail(res, 500, error.message);
    }
    writeAudit({ action: 'deploy.package', detail: `server=${serverUrl}`, sourceIp: clientIp(req) });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=LanAgent-Deploy.zip');
    res.send(buffer);
  });

  return router;
}

export { TASK_LABELS, TASK_TYPES };

export default createManagementRouter;
