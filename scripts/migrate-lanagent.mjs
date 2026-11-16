import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SOURCE_TABLES = ['devices', 'tasks', 'task_results', 'audit_logs'];

function text(value) {
  return value == null ? null : String(value);
}

function toIso(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // 源库存的是北京时间墙钟时间（无时区），统一补成 ISO 字符串并保留原值语义
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return normalized.length >= 19 ? normalized.slice(0, 19) : normalized;
}

function deviceRows(source) {
  return source
    .prepare(
      `SELECT id, hostname, hostname_locked, ip, os_info, status, group_name, rearm_count, agent_version,
              cpu_model, cpu_cores, memory_total_mb, disk_total_gb, disk_free_gb, os_version,
              serial_number, mac_address, manufacturer, model, sysinfo_updated_at,
              token, last_heartbeat, created_at, updated_at, deleted_at
       FROM devices ORDER BY id`
    )
    .all();
}

function taskRows(source) {
  return source.prepare(`SELECT id, task_type, status, params, created_at, updated_at FROM tasks ORDER BY created_at`).all();
}

function resultRows(source) {
  return source
    .prepare(`SELECT id, task_id, device_id, status, output, started_at, finished_at FROM task_results ORDER BY task_id, id`)
    .all();
}

function auditRows(source) {
  return source
    .prepare(`SELECT id, username, action, target, detail, ip_address, created_at FROM audit_logs ORDER BY created_at`)
    .all();
}

function createTargetSchema(db, prefix) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname TEXT NOT NULL,
      hostname_locked INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      os_info TEXT,
      status TEXT NOT NULL DEFAULT 'OFFLINE',
      group_name TEXT,
      rearm_count INTEGER NOT NULL DEFAULT 0,
      agent_version TEXT,
      cpu_model TEXT,
      cpu_cores INTEGER,
      memory_total_mb INTEGER,
      disk_total_gb REAL,
      disk_free_gb REAL,
      os_version TEXT,
      serial_number TEXT,
      mac_address TEXT,
      manufacturer TEXT,
      model TEXT,
      sysinfo_updated_at TEXT,
      token TEXT,
      last_heartbeat TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_${prefix}devices_ip ON ${prefix}devices(ip);
    CREATE INDEX IF NOT EXISTS idx_${prefix}devices_status ON ${prefix}devices(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_${prefix}devices_token ON ${prefix}devices(token) WHERE token IS NOT NULL;

    CREATE TABLE IF NOT EXISTS ${prefix}tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      target_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      payload TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      dispatched_at TEXT,
      finished_at TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_${prefix}tasks_status ON ${prefix}tasks(status);
    CREATE INDEX IF NOT EXISTS idx_${prefix}tasks_created ON ${prefix}tasks(created_at);

    CREATE TABLE IF NOT EXISTS ${prefix}task_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      device_id INTEGER NOT NULL,
      command_id TEXT,
      status TEXT NOT NULL,
      message TEXT,
      output TEXT,
      exit_code INTEGER,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_${prefix}task_results_task ON ${prefix}task_results(task_id);
    CREATE INDEX IF NOT EXISTS idx_${prefix}task_results_device ON ${prefix}task_results(device_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_${prefix}task_results_command ON ${prefix}task_results(command_id) WHERE command_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS ${prefix}audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      device_id INTEGER,
      task_id INTEGER,
      detail TEXT,
      source_ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_${prefix}audit_logs_created ON ${prefix}audit_logs(created_at);

    CREATE TABLE IF NOT EXISTS ${prefix}settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${prefix}id_map (
      entity TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      PRIMARY KEY (entity, source_id)
    );
  `);
}

export function migrateLanagent({ sourcePath, targetPath, prefix = 'sampledev_', apply = false }) {
  if (!fs.existsSync(sourcePath)) throw new Error(`源数据库不存在：${sourcePath}`);
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const report = {
    applied: apply,
    source: sourcePath,
    target: targetPath,
    devices: { total: 0, online: 0, offline: 0, deleted: 0, imported: 0 },
    tasks: { total: 0, imported: 0 },
    taskResults: { total: 0, imported: 0, orphanSkipped: 0, statusCounts: {} },
    auditLogs: { total: 0, imported: 0 },
    warnings: []
  };

  try {
    const devices = deviceRows(source);
    const tasks = taskRows(source);
    const results = resultRows(source);
    const audits = auditRows(source);

    report.devices.total = devices.length;
    for (const row of devices) {
      if (row.status === 'ONLINE') report.devices.online += 1;
      else report.devices.offline += 1;
      if (row.deleted_at) report.devices.deleted += 1;
      if (!row.token) report.warnings.push(`设备 ${row.hostname ?? row.ip} 缺少 token`);
    }
    report.tasks.total = tasks.length;
    report.taskResults.total = results.length;
    report.auditLogs.total = audits.length;
    for (const row of results) {
      report.taskResults.statusCounts[row.status] = (report.taskResults.statusCounts[row.status] ?? 0) + 1;
    }

    const statusValues = new Set(devices.map((row) => row.status));
    for (const value of statusValues) {
      if (!['ONLINE', 'OFFLINE'].includes(value)) {
        report.warnings.push(`devices.status 出现非预期值：${value}`);
      }
    }

    if (!apply) {
      report.plan = {
        devices: devices.length,
        tasks: tasks.length,
        taskResults: results.length,
        auditLogs: audits.length
      };
      return report;
    }

    const target = new Database(targetPath);
    try {
      target.pragma('journal_mode = WAL');
      target.pragma('busy_timeout = 5000');
      createTargetSchema(target, prefix);

      const mapDevice = target.prepare(`INSERT INTO ${prefix}id_map (entity, source_id, target_id) VALUES ('device', ?, ?)`);
      const mapTask = target.prepare(`INSERT INTO ${prefix}id_map (entity, source_id, target_id) VALUES ('task', ?, ?)`);
      const lookup = target.prepare(`SELECT target_id FROM ${prefix}id_map WHERE entity = ? AND source_id = ?`);

      target.transaction(() => {
        const insertDevice = target.prepare(
          `INSERT INTO ${prefix}devices
           (hostname, hostname_locked, ip, os_info, status, group_name, rearm_count, agent_version,
            cpu_model, cpu_cores, memory_total_mb, disk_total_gb, disk_free_gb, os_version,
            serial_number, mac_address, manufacturer, model, sysinfo_updated_at,
            token, last_heartbeat, created_at, updated_at, deleted_at)
           VALUES (@hostname, @hostname_locked, @ip, @os_info, @status, @group_name, @rearm_count, @agent_version,
                   @cpu_model, @cpu_cores, @memory_total_mb, @disk_total_gb, @disk_free_gb, @os_version,
                   @serial_number, @mac_address, @manufacturer, @model, @sysinfo_updated_at,
                   @token, @last_heartbeat, @created_at, @updated_at, @deleted_at)`
        );
        for (const row of devices) {
          const info = insertDevice.run({
            hostname: text(row.hostname) ?? text(row.ip) ?? '未命名设备',
            hostname_locked: Number(row.hostname_locked) ? 1 : 0,
            ip: text(row.ip),
            os_info: text(row.os_info),
            // 契约：devices.status 存大写，迁移时保持原样，不做统一化
            status: row.status === 'ONLINE' ? 'ONLINE' : 'OFFLINE',
            group_name: text(row.group_name),
            rearm_count: Number(row.rearm_count ?? 0),
            agent_version: text(row.agent_version),
            cpu_model: text(row.cpu_model),
            cpu_cores: row.cpu_cores == null ? null : Number(row.cpu_cores),
            memory_total_mb: row.memory_total_mb == null ? null : Number(row.memory_total_mb),
            disk_total_gb: row.disk_total_gb == null ? null : Number(row.disk_total_gb),
            disk_free_gb: row.disk_free_gb == null ? null : Number(row.disk_free_gb),
            os_version: text(row.os_version),
            serial_number: text(row.serial_number),
            mac_address: text(row.mac_address),
            manufacturer: text(row.manufacturer),
            model: text(row.model),
            sysinfo_updated_at: toIso(row.sysinfo_updated_at),
            token: text(row.token),
            last_heartbeat: toIso(row.last_heartbeat),
            created_at: toIso(row.created_at) ?? new Date().toISOString().slice(0, 19),
            updated_at: toIso(row.updated_at) ?? new Date().toISOString().slice(0, 19),
            deleted_at: toIso(row.deleted_at)
          });
          mapDevice.run(String(row.id), Number(info.lastInsertRowid));
          report.devices.imported += 1;
        }

        const insertTask = target.prepare(
          `INSERT INTO ${prefix}tasks (task_type, target_count, status, payload, created_by, created_at, finished_at, note)
           VALUES (@task_type, @target_count, @status, @payload, @created_by, @created_at, @finished_at, @note)`
        );
        for (const row of tasks) {
          const count = target
            .prepare(`SELECT COUNT(*) c FROM ${prefix}task_results WHERE task_id = ?`)
            .get(0).c;
          const info = insertTask.run({
            task_type: text(row.task_type),
            target_count: Number(count) || 0,
            // 契约：tasks.status 存大写
            status: text(row.status) ?? 'PENDING',
            payload: text(row.params),
            created_by: 'legacy-lanagent',
            created_at: toIso(row.created_at) ?? new Date().toISOString().slice(0, 19),
            finished_at: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(row.status) ? toIso(row.updated_at) : null,
            note: '迁移自 LAN Agent 1.x'
          });
          mapTask.run(String(row.id), Number(info.lastInsertRowid));
          report.tasks.imported += 1;
        }

        const insertResult = target.prepare(
          `INSERT INTO ${prefix}task_results
           (task_id, device_id, command_id, status, output, started_at, finished_at, created_at, updated_at)
           VALUES (@task_id, @device_id, @command_id, @status, @output, @started_at, @finished_at, @created_at, @updated_at)`
        );
        for (const row of results) {
          const taskId = lookup.get('task', String(row.task_id))?.target_id;
          const deviceId = lookup.get('device', String(row.device_id))?.target_id;
          if (!taskId || !deviceId) {
            report.taskResults.orphanSkipped += 1;
            continue;
          }
          const status = text(row.status) ?? 'unknown';
          insertResult.run({
            task_id: taskId,
            device_id: deviceId,
            // 源 command_id 即源 task_results.id（uuid），迁移后作为幂等键保留
            command_id: String(row.id),
            status,
            output: text(row.output),
            started_at: toIso(row.started_at),
            finished_at: toIso(row.finished_at),
            created_at: toIso(row.started_at) ?? new Date().toISOString().slice(0, 19),
            updated_at: toIso(row.finished_at) ?? toIso(row.started_at) ?? new Date().toISOString().slice(0, 19)
          });
          report.taskResults.imported += 1;
        }

        const insertAudit = target.prepare(
          `INSERT INTO ${prefix}audit_logs (action, device_id, task_id, detail, source_ip, created_at)
           VALUES (@action, @device_id, @task_id, @detail, @source_ip, @created_at)`
        );
        for (const row of audits) {
          insertAudit.run({
            action: text(row.action) ?? 'legacy',
            device_id: null,
            task_id: null,
            detail: [row.username ? `操作人：${row.username}` : null, text(row.target), text(row.detail)]
              .filter(Boolean)
              .join(' | ') || null,
            source_ip: text(row.ip_address),
            created_at: toIso(row.created_at) ?? new Date().toISOString().slice(0, 19)
          });
          report.auditLogs.imported += 1;
        }
      })();

      target
        .prepare(
          `INSERT INTO ${prefix}settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .run('migration_source', sourcePath, new Date().toISOString());
    } finally {
      target.close();
    }

    return report;
  } finally {
    source.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [sourcePath, targetPath, mode] = process.argv.slice(2);
  if (!sourcePath || !targetPath) {
    console.error('用法：node migrate-lanagent.mjs <源 lanagent.db> <目标 store.sqlite> [--apply]');
    process.exit(2);
  }
  const resolvedSource = path.resolve(sourcePath);
  const resolvedTarget = path.resolve(targetPath);
  if (mode === '--apply' && resolvedSource === resolvedTarget) {
    console.error('源与目标是同一个文件，拒绝执行');
    process.exit(2);
  }
  const report = migrateLanagent({ sourcePath: resolvedSource, targetPath: resolvedTarget, apply: mode === '--apply' });
  console.log(JSON.stringify(report, null, 2));
}
