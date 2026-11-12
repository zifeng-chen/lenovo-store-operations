import Database from 'better-sqlite3';
import { getUnifiedDatabase, tableName } from '../../db/unified-database.js';
import { currentCalendarDate, normalizeAddedDate } from '../../calendar-date.js';

const PRODUCTS = tableName('computer-labels', 'products');

export const DATABASE_PATH = null;

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${PRODUCTS} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      config TEXT,
      color TEXT,
      sku TEXT UNIQUE NOT NULL,
      remark TEXT,
      added_date TEXT NOT NULL,
      stock_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_${PRODUCTS}_sku ON ${PRODUCTS}(sku);
    CREATE INDEX IF NOT EXISTS idx_${PRODUCTS}_name ON ${PRODUCTS}(name);
  `);
}

function migrateSchema(db) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${PRODUCTS})`).all().map(column => column.name));
  if (!columns.has('added_date')) db.exec(`ALTER TABLE ${PRODUCTS} ADD COLUMN added_date TEXT`);
  if (!columns.has('stock_date')) db.exec(`ALTER TABLE ${PRODUCTS} ADD COLUMN stock_date TEXT`);

  const fallback = currentCalendarDate();
  const update = db.prepare(`UPDATE ${PRODUCTS} SET added_date = ? WHERE id = ?`);
  const rows = db.prepare(`SELECT id, added_date, created_at FROM ${PRODUCTS}`).all();
  db.transaction(() => {
    rows.forEach(row => {
      const normalized = normalizeAddedDate(row.added_date, row.created_at, fallback);
      if (normalized !== row.added_date) update.run(normalized, row.id);
    });
  })();

  // 新增的入库时间对历史数据默认沿用添加日期，避免标签上出现空白。
  db.exec(`UPDATE ${PRODUCTS} SET stock_date = added_date WHERE stock_date IS NULL OR TRIM(stock_date) = ''`);
}

export function initializeDatabase() {
  const db = getUnifiedDatabase();
  createSchema(db);
  migrateSchema(db);
  return db;
}

export function getDatabase() {
  return getUnifiedDatabase();
}

export async function createDatabaseBackup(targetPath) {
  await getUnifiedDatabase().backup(targetPath);
}

export function restoreDatabase(sourcePath) {
  validateRestoreFile(sourcePath);
  const db = getUnifiedDatabase();
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const rows = source.prepare(`SELECT id, name, config, color, sku, remark, added_date, stock_date, created_at, updated_at FROM ${PRODUCTS} ORDER BY id`).all();
    const insert = db.prepare(
      `INSERT INTO ${PRODUCTS} (id, name, config, color, sku, remark, added_date, stock_date, created_at, updated_at) VALUES (@id, @name, @config, @color, @sku, @remark, @added_date, @stock_date, @created_at, @updated_at)`
    );
    db.transaction(() => {
      db.prepare(`DELETE FROM ${PRODUCTS}`).run();
      // 旧备份没有 stock_date，恢复时回退到 added_date。
      for (const row of rows) insert.run({ ...row, stock_date: row.stock_date ?? row.added_date });
    })();
  } finally {
    source.close();
  }
}

function validateRestoreFile(filePath) {
  const candidate = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = candidate.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error('数据库完整性检查失败');

    const table = candidate.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products'"
    ).get();
    if (!table) throw new Error('备份文件中缺少 products 表');


    const columns = candidate.prepare('PRAGMA table_info(products)').all();
    const byName = new Map(columns.map((column) => [column.name, column]));
    const required = ['id', 'name', 'config', 'color', 'sku', 'remark', 'created_at', 'updated_at'];
    const idColumn = byName.get('id');
    const nameColumn = byName.get('name');
    const skuColumn = byName.get('sku');
    if (
      !required.every((column) => byName.has(column))
      || idColumn.type.toUpperCase() !== 'INTEGER'
      || idColumn.pk !== 1
      || nameColumn.notnull !== 1
      || skuColumn.notnull !== 1
    ) {
      throw new Error('products 表结构不兼容');
    }

    const indexInfo = candidate.prepare('SELECT name FROM pragma_index_info(?)');
    const hasUniqueSku = candidate.prepare('PRAGMA index_list(products)').all().some((index) => {
      if (!index.unique) return false;
      const indexedColumns = indexInfo.all(index.name);
      return indexedColumns.length === 1 && indexedColumns[0].name === 'sku';
    });
    if (!hasUniqueSku) throw new Error('products 表缺少 SKU 唯一约束');
  } finally {
    candidate.close();
  }
}

export { PRODUCTS };
