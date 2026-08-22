import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  PRICE_LABELS_DATA_DIR,
  PRICE_LABELS_DATABASE_PATH,
} from '../../config/data-paths.js'

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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_price_labels_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_price_labels_products_updated_at ON products(updated_at DESC);
  `)
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
