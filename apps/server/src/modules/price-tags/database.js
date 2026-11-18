import { getUnifiedDatabase, tableName } from '../../db/unified-database.js'

export const CARDS = tableName('price-tags', 'cards')
export const SERVICES = tableName('price-tags', 'services')
export const SELECTION = tableName('price-tags', 'selection')
export const CONFIG = tableName('price-tags', 'config')

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

    CREATE INDEX IF NOT EXISTS idx_${CARDS}_category ON ${CARDS}(category);
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
