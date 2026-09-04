import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  PRICE_LABELS_DATA_DIR,
  PRICE_LABELS_DATABASE_PATH,
} from '../../config/data-paths.js'
import { currentCalendarDate, normalizeAddedDate } from '../../calendar-date.js'

const DEFAULT_CATEGORIES = ['背包', '键鼠', '耳机', '充电器', '支架', '电脑配件', '音响', '打印机']
const databaseDirectory = PRICE_LABELS_DATA_DIR
export const DATABASE_PATH = PRICE_LABELS_DATABASE_PATH

let database

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL REFERENCES categories(name) ON UPDATE CASCADE,
      price REAL NOT NULL CHECK(price >= 0),
      added_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_price_labels_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_price_labels_products_updated_at ON products(updated_at DESC);
  `)
}

function migrateSchema(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(products)').all().map(column => column.name))
  if (!columns.has('added_date')) db.exec('ALTER TABLE products ADD COLUMN added_date TEXT')

  const fallback = currentCalendarDate()
  const update = db.prepare('UPDATE products SET added_date = ? WHERE id = ?')
  const rows = db.prepare('SELECT id, added_date, created_at FROM products').all()
  db.transaction(() => {
    rows.forEach(row => {
      const normalized = normalizeAddedDate(row.added_date, row.created_at, fallback)
      if (normalized !== row.added_date) update.run(normalized, row.id)
    })
  })()
}

function seedDefaultCategories(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count
  if (count !== 0) return

  const insert = db.prepare('INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)')
  db.transaction((categories) => {
    categories.forEach((name, index) => insert.run(name, index + 1))
  })(DEFAULT_CATEGORIES)
}

function openDatabase() {
  fs.mkdirSync(databaseDirectory, { recursive: true })
  const db = new Database(DATABASE_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createSchema(db)
  migrateSchema(db)
  seedDefaultCategories(db)
  database = db
  return db
}

export function initializeDatabase() {
  return database?.open ? database : openDatabase()
}

export function getDatabase() {
  return database?.open ? database : openDatabase()
}
