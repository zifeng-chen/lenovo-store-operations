import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  COMPUTER_LABELS_DATA_DIR,
  COMPUTER_LABELS_DATABASE_PATH
} from '../../config/data-paths.js';
import { currentCalendarDate, normalizeAddedDate } from '../../calendar-date.js';

const databaseDir = COMPUTER_LABELS_DATA_DIR;

export const DATABASE_PATH = COMPUTER_LABELS_DATABASE_PATH;

let database;

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      config TEXT,
      color TEXT,
      sku TEXT UNIQUE NOT NULL,
      remark TEXT,
      added_date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_computer_labels_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_computer_labels_products_name ON products(name);
  `);
}

function migrateSchema(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(products)').all().map(column => column.name));
  if (!columns.has('added_date')) db.exec('ALTER TABLE products ADD COLUMN added_date TEXT');

  const fallback = currentCalendarDate();
  const update = db.prepare('UPDATE products SET added_date = ? WHERE id = ?');
  const rows = db.prepare('SELECT id, added_date, created_at FROM products').all();
  db.transaction(() => {
    rows.forEach(row => {
      const normalized = normalizeAddedDate(row.added_date, row.created_at, fallback);
      if (normalized !== row.added_date) update.run(normalized, row.id);
    });
  })();
}

function openDatabase() {
  fs.mkdirSync(databaseDir, { recursive: true });
  database = new Database(DATABASE_PATH);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  createSchema(database);
  migrateSchema(database);
  return database;
}

export function initializeDatabase() {
  return database?.open ? database : openDatabase();
}

export function getDatabase() {
  return database?.open ? database : openDatabase();
}

export async function createDatabaseBackup(targetPath) {
  await getDatabase().backup(targetPath);
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

function removeDatabaseSidecars() {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${DATABASE_PATH}${suffix}`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
}

export function restoreDatabase(sourcePath) {
  validateRestoreFile(sourcePath);
  fs.mkdirSync(databaseDir, { recursive: true });

  const operationId = randomUUID();
  const stagedPath = path.join(databaseDir, `.database-${operationId}.staged.sqlite`);
  const rollbackPath = path.join(databaseDir, `.database-${operationId}.rollback.sqlite`);
  const hadDatabase = fs.existsSync(DATABASE_PATH);
  let oldDatabaseMoved = false;
  let newDatabaseInstalled = false;

  try {
    fs.copyFileSync(sourcePath, stagedPath);
    validateRestoreFile(stagedPath);

    if (hadDatabase && !database?.open) getDatabase();
    if (database?.open) {
      database.pragma('wal_checkpoint(TRUNCATE)');
      database.close();
    }
    database = undefined;
    removeDatabaseSidecars();

    if (hadDatabase) {
      fs.renameSync(DATABASE_PATH, rollbackPath);
      oldDatabaseMoved = true;
    }
    fs.renameSync(stagedPath, DATABASE_PATH);
    newDatabaseInstalled = true;
    openDatabase();

    if (oldDatabaseMoved && fs.existsSync(rollbackPath)) {
      fs.unlinkSync(rollbackPath);
      oldDatabaseMoved = false;
    }
  } catch (error) {
    if (database?.open) database.close();
    database = undefined;
    removeDatabaseSidecars();

    if (newDatabaseInstalled && fs.existsSync(DATABASE_PATH)) fs.unlinkSync(DATABASE_PATH);
    if (oldDatabaseMoved && fs.existsSync(rollbackPath)) {
      fs.renameSync(rollbackPath, DATABASE_PATH);
      oldDatabaseMoved = false;
    }
    if (hadDatabase && fs.existsSync(DATABASE_PATH)) openDatabase();
    throw error;
  } finally {
    if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
  }
}
