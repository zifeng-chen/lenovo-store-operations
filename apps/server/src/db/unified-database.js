import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { UNIFIED_DATA_DIR, UNIFIED_DATABASE_PATH } from '../config/data-paths.js'

/**
 * 统一数据库：一个 SQLite 文件承载所有模块的数据表。
 * 各模块的表统一加模块前缀（如 computer_products、price_products），
 * 表结构、索引和读写互不影响，等价于原来每个模块独立一个库。
 */

export const TABLE_PREFIX = Object.freeze({
  'computer-labels': 'computer_',
  'price-labels': 'price_',
  'receipt-assistant': 'receipt_',
})

export function tableName(moduleId, name) {
  const prefix = TABLE_PREFIX[moduleId]
  if (!prefix) throw new Error(`未知持久化模块：${moduleId}`)
  return `${prefix}${name}`
}

let unifiedDatabase = null

export function openUnifiedDatabase() {
  if (unifiedDatabase?.open) return unifiedDatabase
  fs.mkdirSync(UNIFIED_DATA_DIR, { recursive: true })
  const db = new Database(UNIFIED_DATABASE_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  unifiedDatabase = db
  return db
}

export function getUnifiedDatabase() {
  return unifiedDatabase?.open ? unifiedDatabase : openUnifiedDatabase()
}

export function closeUnifiedDatabase() {
  if (unifiedDatabase?.open) unifiedDatabase.close()
  unifiedDatabase = null
}

export const UNIFIED_DATABASE_DIR = UNIFIED_DATA_DIR
export { UNIFIED_DATABASE_PATH }
