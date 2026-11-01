import { getUnifiedDatabase, tableName } from '../../db/unified-database.js'
import { currentCalendarDate, normalizeAddedDate } from '../../calendar-date.js'

const DEFAULT_CATEGORIES = ['背包', '键鼠', '耳机', '充电器', '支架', '电脑配件', '音响', '打印机']

export const CATEGORIES = tableName('price-labels', 'categories')
export const PRICE_PRODUCTS = tableName('price-labels', 'products')

let initialized = false

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${CATEGORIES} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ${PRICE_PRODUCTS} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL REFERENCES ${CATEGORIES}(name) ON UPDATE CASCADE,
      price REAL NOT NULL CHECK(price >= 0),
      added_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_${PRICE_PRODUCTS}_category ON ${PRICE_PRODUCTS}(category);
    CREATE INDEX IF NOT EXISTS idx_${PRICE_PRODUCTS}_updated_at ON ${PRICE_PRODUCTS}(updated_at DESC);
  `)
}

function migrateSchema(db) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${PRICE_PRODUCTS})`).all().map(column => column.name))
  if (!columns.has('added_date')) db.exec(`ALTER TABLE ${PRICE_PRODUCTS} ADD COLUMN added_date TEXT`)

  const fallback = currentCalendarDate()
  const update = db.prepare(`UPDATE ${PRICE_PRODUCTS} SET added_date = ? WHERE id = ?`)
  const rows = db.prepare(`SELECT id, added_date, created_at FROM ${PRICE_PRODUCTS}`).all()
  db.transaction(() => {
    rows.forEach(row => {
      const normalized = normalizeAddedDate(row.added_date, row.created_at, fallback)
      if (normalized !== row.added_date) update.run(normalized, row.id)
    })
  })()
}

function seedDefaultCategories(db) {
  const count = db.prepare(`SELECT COUNT(*) AS count FROM ${CATEGORIES}`).get().count
  if (count !== 0) return

  const insert = db.prepare(`INSERT OR IGNORE INTO ${CATEGORIES} (name, sort_order) VALUES (?, ?)`)
  db.transaction((categories) => {
    categories.forEach((name, index) => insert.run(name, index + 1))
  })(DEFAULT_CATEGORIES)
}

export function initializeDatabase() {
  const db = getUnifiedDatabase()
  if (!initialized) {
    createSchema(db)
    migrateSchema(db)
    seedDefaultCategories(db)
    initialized = true
  }
  return db
}

export function getDatabase() {
  return getUnifiedDatabase()
}
