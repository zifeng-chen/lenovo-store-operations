import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  RECEIPT_ASSISTANT_DATA_DIR,
  RECEIPT_ASSISTANT_DATABASE_PATH,
  RECEIPT_OCR_KEY_PATH,
} from '../../config/data-paths.js'

const databaseDirectory = RECEIPT_ASSISTANT_DATA_DIR
export const DATABASE_PATH = RECEIPT_ASSISTANT_DATABASE_PATH
export const OCR_KEY_PATH = RECEIPT_OCR_KEY_PATH

let database

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_date TEXT NOT NULL,
      amount REAL NOT NULL,
      status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_sales_date_status
      ON sales (sale_date, status);
  `)
}

function openDatabase() {
  fs.mkdirSync(databaseDirectory, { recursive: true })
  const db = new Database(DATABASE_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  createSchema(db)
  database = db
  return db
}

export function initializeDatabase() {
  return database?.open ? database : openDatabase()
}

export function getDatabase() {
  return database?.open ? database : openDatabase()
}
