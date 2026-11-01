import { getUnifiedDatabase, tableName } from '../../db/unified-database.js'
import { RECEIPT_OCR_KEY_PATH } from '../../config/data-paths.js'

export const DATABASE_PATH = null
export const OCR_KEY_PATH = RECEIPT_OCR_KEY_PATH

export const SALES = tableName('receipt-assistant', 'sales')
export const SALE_ITEMS = tableName('receipt-assistant', 'sale_items')
export const OCR_CONFIG = tableName('receipt-assistant', 'ocr_config')
export const OCR_HISTORY = tableName('receipt-assistant', 'ocr_history')
export const OCR_USAGE = tableName('receipt-assistant', 'ocr_usage')

let initialized = false

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SALES} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_date TEXT NOT NULL,
      amount REAL NOT NULL,
      status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_${SALES}_date_status
      ON ${SALES} (sale_date, status);
    CREATE TABLE IF NOT EXISTS ${SALE_ITEMS} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES ${SALES}(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      qty REAL,
      unit_price REAL,
      subtotal REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_${SALE_ITEMS}_sale_id
      ON ${SALE_ITEMS} (sale_id);
  `)
}

export function initializeDatabase() {
  const db = getUnifiedDatabase()
  if (!initialized) {
    createSchema(db)
    initialized = true
  }
  return db
}

export function getDatabase() {
  return getUnifiedDatabase()
}
