import { getUnifiedDatabase, tableName } from '../../db/unified-database.js';

export const DEVICES = tableName('sample-devices', 'devices');
export const TASKS = tableName('sample-devices', 'tasks');
export const TASK_RESULTS = tableName('sample-devices', 'task_results');
export const AUDIT_LOGS = tableName('sample-devices', 'audit_logs');
export const SETTINGS = tableName('sample-devices', 'settings');

export const DEVICE_STATUS = Object.freeze({ ONLINE: 'ONLINE', OFFLINE: 'OFFLINE' });
export const TASK_STATUS = Object.freeze({
  PENDING: 'PENDING',
  DISPATCHED: 'DISPATCHED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});
export const TASK_RESULT_STATUS = Object.freeze({ SUCCESS: 'success', FAILED: 'failed', CANCELLED: 'cancelled' });
export const TASK_TYPES = Object.freeze([
  'SYSPREP',
  'SYSPREP_REBOOT',
  'SHUTDOWN',
  'REBOOT',
  'STATUS',
  'UPGRADE',
  'FILE_PUSH',
  'HOSTMSG',
  'SYSINFO',
  'RESET_PWD'
]);

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${DEVICES} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname TEXT,
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
      -- 迁移前 lanagent 的 UUID 主键，老 Agent 的 WS 路径仍带着它
      legacy_id TEXT,
      last_heartbeat TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_${DEVICES}_ip ON ${DEVICES}(ip);
    CREATE INDEX IF NOT EXISTS idx_${DEVICES}_status ON ${DEVICES}(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_${DEVICES}_token ON ${DEVICES}(token) WHERE token IS NOT NULL;

    CREATE TABLE IF NOT EXISTS ${TASKS} (
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
    CREATE INDEX IF NOT EXISTS idx_${TASKS}_status ON ${TASKS}(status);
    CREATE INDEX IF NOT EXISTS idx_${TASKS}_created ON ${TASKS}(created_at);

    CREATE TABLE IF NOT EXISTS ${TASK_RESULTS} (
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
    CREATE INDEX IF NOT EXISTS idx_${TASK_RESULTS}_task ON ${TASK_RESULTS}(task_id);
    CREATE INDEX IF NOT EXISTS idx_${TASK_RESULTS}_device ON ${TASK_RESULTS}(device_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_${TASK_RESULTS}_command ON ${TASK_RESULTS}(command_id) WHERE command_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS ${AUDIT_LOGS} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      device_id INTEGER,
      task_id INTEGER,
      detail TEXT,
      source_ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_${AUDIT_LOGS}_created ON ${AUDIT_LOGS}(created_at);

    CREATE TABLE IF NOT EXISTS ${SETTINGS} (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

function ensureDeviceColumns(db) {
  // 已存在的库不会被 CREATE TABLE IF NOT EXISTS 改结构，这里补上后加的列。
  const columns = new Set(db.prepare(`PRAGMA table_info(${DEVICES})`).all().map(column => column.name));
  if (!columns.has('legacy_id')) {
    db.exec(`ALTER TABLE ${DEVICES} ADD COLUMN legacy_id TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${DEVICES}_legacy ON ${DEVICES}(legacy_id) WHERE legacy_id IS NOT NULL`);
}

export function initializeDatabase() {
  const db = getUnifiedDatabase();
  createSchema(db);
  ensureDeviceColumns(db);
  return db;
}

export function getDatabase() {
  return getUnifiedDatabase();
}

export async function createDatabaseBackup(targetPath) {
  await getUnifiedDatabase().backup(targetPath);
}

export function getSetting(key, fallback = null) {
  const row = getUnifiedDatabase().prepare(`SELECT value FROM ${SETTINGS} WHERE key = ?`).get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getUnifiedDatabase()
    .prepare(
      `INSERT INTO ${SETTINGS} (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value == null ? null : String(value), new Date().toISOString());
}

let lastAuditPruneAt = 0;

export function writeAudit({ action, deviceId = null, taskId = null, detail = null, sourceIp = null }) {
  const db = getUnifiedDatabase();
  db.prepare(`INSERT INTO ${AUDIT_LOGS} (action, device_id, task_id, detail, source_ip, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(action, deviceId, taskId, detail, sourceIp, new Date().toISOString());
  // 心跳类审计写入频繁，按小时节流，不每次都扫一遍表。
  if (Date.now() - lastAuditPruneAt < 60 * 60 * 1000) return;
  lastAuditPruneAt = Date.now();
  pruneAuditLogs(db);
}

// 保留策略：任务记录最多 50 条，操作审计只留 3 天。
// 删除时连带清理子结果，未结束的任务一律规避，避免把进行中的记录删掉。
export const MAX_TASK_RECORDS = 50;
export const AUDIT_RETENTION_DAYS = 3;

const UNFINISHED_TASK_STATUSES = [TASK_STATUS.PENDING, TASK_STATUS.DISPATCHED, TASK_STATUS.RUNNING];

export function pruneTaskRecords(db = getUnifiedDatabase()) {
  const rows = db.prepare(`SELECT id, status FROM ${TASKS} ORDER BY id DESC`).all();
  const unfinished = rows.filter(row => UNFINISHED_TASK_STATUSES.includes(row.status));
  // 未结束的任务始终保留，但会占掉 50 条配额；配额用尽后只按新到旧保留已结束的记录。
  const budget = Math.max(MAX_TASK_RECORDS - unfinished.length, 0);
  const finished = rows.filter(row => !UNFINISHED_TASK_STATUSES.includes(row.status)).slice(0, budget);
  const keep = new Set([...unfinished, ...finished].map(row => row.id));
  const stale = rows.filter(row => !keep.has(row.id)).map(row => row.id);
  if (!stale.length) return 0;

  const deleteResults = db.prepare(`DELETE FROM ${TASK_RESULTS} WHERE task_id = ?`);
  const deleteTask = db.prepare(`DELETE FROM ${TASKS} WHERE id = ?`);
  db.transaction(() => {
    for (const taskId of stale) {
      deleteResults.run(taskId);
      deleteTask.run(taskId);
    }
  })();
  return stale.length;
}

export function pruneAuditLogs(db = getUnifiedDatabase()) {
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`DELETE FROM ${AUDIT_LOGS} WHERE created_at < ?`).run(cutoff).changes;
}

export function pruneRetainedRecords(db = getUnifiedDatabase()) {
  const tasks = pruneTaskRecords(db);
  const audits = pruneAuditLogs(db);
  if (tasks || audits) {
    db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  }
  return { tasks, audits };
}
