import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(currentDirectory, '../../../../..')
const databaseDirectory = path.join(projectRoot, 'data', 'receipt-assistant')
export const DATABASE_PATH = path.join(databaseDirectory, 'database.sqlite')
export const OCR_KEY_PATH = path.join(projectRoot, 'data', 'secrets', 'receipt-ocr.key')

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
