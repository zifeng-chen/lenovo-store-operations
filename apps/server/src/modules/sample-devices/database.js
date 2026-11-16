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

export function initializeDatabase() {
  const db = getUnifiedDatabase();
  createSchema(db);
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

export function writeAudit({ action, deviceId = null, taskId = null, detail = null, sourceIp = null }) {
  getUnifiedDatabase()
    .prepare(`INSERT INTO ${AUDIT_LOGS} (action, device_id, task_id, detail, source_ip, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(action, deviceId, taskId, detail, sourceIp, new Date().toISOString());
}
