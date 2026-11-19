import { getUnifiedDatabase, tableName } from '../../db/unified-database.js'

export const CARDS = tableName('price-tags', 'cards')
export const SERVICES = tableName('price-tags', 'services')
export const SELECTION = tableName('price-tags', 'selection')
export const CONFIG = tableName('price-tags', 'config')
// 用户自建的卖点文案：按「分类 + 图标名」归属，与内置文案同一维度，选中图标后一起出现在下拉框里
export const COPIES = tableName('price-tags', 'feature_copies')

let initialized = false

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${CARDS} (
      id TEXT PRIMARY KEY,
      product_title TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '笔记本',
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ${SERVICES} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT '',
      product_category TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ${SELECTION} (
      card_id TEXT PRIMARY KEY,
      selected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ${CONFIG} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ${COPIES} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT '笔记本',
      icon_name TEXT NOT NULL,
      title TEXT NOT NULL,
      desc TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_${CARDS}_category ON ${CARDS}(category);
    CREATE INDEX IF NOT EXISTS idx_${COPIES}_lookup ON ${COPIES}(category, icon_name);
  `)
}

export function initializeDatabase() {
  if (initialized) return
  const db = getUnifiedDatabase()
  createSchema(db)
  initialized = true
}

export function getDatabase() {
  initializeDatabase()
  return getUnifiedDatabase()
}
