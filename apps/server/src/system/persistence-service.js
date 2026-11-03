import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  createOcrStorage,
  decodeEnvironmentKey,
  decryptOcrCredentials,
  encryptOcrCredentials,
  isValidOcrBillingMonth,
  loadOrCreateLocalKey,
} from '../modules/receipt-assistant/ocr-storage.js'
import { writeBackupPackage } from './backup-package.js'
import { isValidCalendarDate, normalizeAddedDate } from '../calendar-date.js'
import { tableName } from '../db/unified-database.js'

// 统一库里各模块的表带前缀，但备份快照保持历史格式（裸表名），
// 这样校验与恢复逻辑无需改动，旧备份也继续可读。
const PREFIX_TABLES = {
  'computer-labels': { products: tableName('computer-labels', 'products') },
  'price-labels': {
    categories: tableName('price-labels', 'categories'),
    products: tableName('price-labels', 'products'),
  },
  'receipt-assistant': {
    sales: tableName('receipt-assistant', 'sales'),
    sale_items: tableName('receipt-assistant', 'sale_items'),
    ocr_config: tableName('receipt-assistant', 'ocr_config'),
    ocr_history: tableName('receipt-assistant', 'ocr_history'),
    ocr_usage: tableName('receipt-assistant', 'ocr_usage'),
  },
}

/**
 * 把统一库快照裁剪成只含指定模块的表，并把表名改回裸名，
 * 输出一个与历史单模块库完全同构的临时库文件。
 */
function extractModuleSnapshot(sharedSnapshotPath, targetPath, moduleId) {
  const mapping = PREFIX_TABLES[moduleId]
  if (!mapping) throw new Error(`未知模块：${moduleId}`)
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath)
  const source = new Database(sharedSnapshotPath, { readonly: true, fileMustExist: true })
  const target = new Database(targetPath)
  try {
    target.pragma('journal_mode = DELETE')
    const tableSql = source.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    const indexSql = source.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all()
    const physicalToLogical = new Map(Object.entries(mapping).map(([logical, physical]) => [physical, logical]))

    target.exec('BEGIN')
    for (const [physical, logical] of physicalToLogical) {
      const entry = tableSql.find(item => item.name === physical)
      if (!entry) continue
      // 把建表 SQL 里的物理表名替换为裸表名，并去掉跨模块外键/索引前缀差异
      let sql = entry.sql.replace(new RegExp(`\\b${physical}\\b`, 'g'), logical)
      for (const [otherPhysical, otherLogical] of physicalToLogical) {
        sql = sql.replace(new RegExp(`\\b${otherPhysical}\\b`, 'g'), otherLogical)
      }
      target.exec(sql)
      const rows = source.prepare(`SELECT * FROM ${physical}`).all()
      if (rows.length) {
        const columns = Object.keys(rows[0])
        const placeholders = columns.map(() => '?').join(', ')
        const insert = target.prepare(`INSERT INTO ${logical} (${columns.join(', ')}) VALUES (${placeholders})`)
        for (const row of rows) insert.run(...columns.map(column => row[column]))
      }
    }
    for (const index of indexSql) {
      let sql = index.sql
      let relevant = false
      for (const [physical, logical] of physicalToLogical) {
        if (sql.includes(physical)) {
          sql = sql.replace(new RegExp(`\\b${physical}\\b`, 'g'), logical)
          relevant = true
        }
      }
      if (!relevant) continue
      try { target.exec(sql) } catch { /* 索引名冲突或已存在时忽略 */ }
    }
    target.exec('COMMIT')
  } catch (error) {
    try { target.exec('ROLLBACK') } catch {}
    throw error
  } finally {
    source.close()
    target.close()
  }
}

const MODULES = [
  { id: 'computer-labels', name: '仓库货品标签', entryId: 'computer-labels.database' },
  { id: 'price-labels', name: '周边货品价签', entryId: 'price-labels.database' },
  { id: 'receipt-assistant', name: '付款凭证打印', entryId: 'receipt-assistant.database' },
]
const ROW_LIMITS = {
  'computer-labels.products': 200000,
  'price-labels.categories': 5000,
  'price-labels.products': 200000,
  'receipt-assistant.sales': 2000000,
  'receipt-assistant.sale_items': 4000000,
  'receipt-assistant.ocr_config': 1,
  'receipt-assistant.ocr_history': 2000000,
  'receipt-assistant.ocr_usage': 4000000,
}

function persistenceError(message, status = 400, code = 'INVALID_BACKUP_DATA') {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function openCandidate(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true })
  db.pragma('query_only = ON')
  db.pragma('trusted_schema = OFF')
  return db
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function requireColumns(db, table, required, optional = []) {
  if (!tableExists(db, table)) throw persistenceError(`数据库缺少 ${table} 表`)
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name)
  const allowed = new Set([...required, ...optional])
  if (required.some(column => !columns.includes(column)) || columns.some(column => !allowed.has(column))) {
    throw persistenceError(`${table} 表结构与当前版本不兼容`)
  }
  return new Set(columns)
}

function isValidTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
}

function hasBlankText(value, maxLength) {
  return typeof value !== 'string' || !value.trim() || value.length > maxLength
}

function hasInvalidRow(statement, predicate) {
  for (const row of statement.iterate()) {
    if (predicate(row)) return true
  }
  return false
}

function countRows(db, moduleId, table) {
  const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)
  if (!Number.isSafeInteger(count) || count < 0 || count > ROW_LIMITS[`${moduleId}.${table}`]) {
    throw persistenceError(`${table} 表记录数量超出允许范围`)
  }
  return count
}

async function validateDatabase(filePath, moduleId) {
  const db = openCandidate(filePath)
  try {
    const integrity = db.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw persistenceError('SQLite 完整性检查失败')
    if (moduleId === 'computer-labels') {
      const productColumns = requireColumns(db, 'products', ['id', 'name', 'config', 'color', 'sku', 'remark', 'created_at', 'updated_at'], ['added_date'])
      const dateColumn = productColumns.has('added_date') ? ', added_date' : ''
      const invalid = hasInvalidRow(db.prepare(`SELECT id, name, config, color, sku, remark, created_at, updated_at${dateColumn} FROM products`), row => !Number.isSafeInteger(row.id) || row.id <= 0
        || hasBlankText(row.name, 1000) || hasBlankText(row.sku, 1000)
        || ['config', 'color', 'remark'].some(field => row[field] !== null && (typeof row[field] !== 'string' || row[field].length > 10000))
        || (row.created_at !== null && !isValidTimestamp(row.created_at))
        || (row.updated_at !== null && !isValidTimestamp(row.updated_at))
        || (productColumns.has('added_date') && !isValidCalendarDate(row.added_date)))
      const duplicate = db.prepare('SELECT 1 FROM products GROUP BY id HAVING COUNT(*) > 1 UNION ALL SELECT 1 FROM products GROUP BY sku HAVING COUNT(*) > 1 LIMIT 1').get()
      if (invalid || duplicate) throw persistenceError('products 表包含空白、超长、日期无效或重复 SKU 数据')
      return { products: countRows(db, moduleId, 'products') }
    }
    if (moduleId === 'price-labels') {
      requireColumns(db, 'categories', ['id', 'name', 'sort_order'])
      const productColumns = requireColumns(db, 'products', ['id', 'name', 'category', 'price', 'created_at', 'updated_at'], ['added_date'])
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw persistenceError('价签数据库外键检查失败')
      const invalidCategory = hasInvalidRow(db.prepare('SELECT id, name, sort_order FROM categories'), row => !Number.isSafeInteger(row.id) || row.id <= 0
        || hasBlankText(row.name, 30) || row.name.trim() === '全部' || !Number.isSafeInteger(row.sort_order) || row.sort_order < 0)
      const dateColumn = productColumns.has('added_date') ? ', added_date' : ''
      const invalidProduct = hasInvalidRow(db.prepare(`SELECT id, name, category, price, created_at, updated_at${dateColumn} FROM products`), row => !Number.isSafeInteger(row.id) || row.id <= 0
        || hasBlankText(row.name, 100) || hasBlankText(row.category, 30)
        || typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price < 0
        || Math.abs(row.price * 100 - Math.round(row.price * 100)) > 1e-8
        || !isValidTimestamp(row.created_at) || !isValidTimestamp(row.updated_at)
        || Date.parse(row.created_at) > Date.parse(row.updated_at)
        || (productColumns.has('added_date') && !isValidCalendarDate(row.added_date)))
      const duplicateOrOrphan = db.prepare(`
        SELECT 1 FROM categories GROUP BY id HAVING COUNT(*) > 1
        UNION ALL SELECT 1 FROM categories GROUP BY name HAVING COUNT(*) > 1
        UNION ALL SELECT 1 FROM products GROUP BY id HAVING COUNT(*) > 1
        UNION ALL SELECT 1 FROM products p LEFT JOIN categories c ON c.name = p.category WHERE c.name IS NULL
        LIMIT 1
      `).get()
      if (invalidCategory || invalidProduct || duplicateOrOrphan) throw persistenceError('价签数据库包含重复、失联、空白、超长、价格或日期无效的数据')
      return {
        categories: countRows(db, moduleId, 'categories'),
        products: countRows(db, moduleId, 'products'),
      }
    }
    if (moduleId === 'receipt-assistant') {
      requireColumns(db, 'sales', ['id', 'sale_date', 'amount', 'status', 'created_at'])
      const invalid = hasInvalidRow(db.prepare('SELECT id, sale_date, amount, status, created_at FROM sales'), row => !Number.isSafeInteger(row.id) || row.id <= 0
        || !isValidCalendarDate(row.sale_date) || typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0
        || Math.abs(row.amount * 100 - Math.round(row.amount * 100)) > 1e-8
        || ![0, 1].includes(row.status) || !isValidTimestamp(row.created_at))
      const duplicateSale = db.prepare('SELECT 1 FROM sales GROUP BY id HAVING COUNT(*) > 1 LIMIT 1').get()
      if (invalid || duplicateSale) throw persistenceError('付款凭证数据库包含重复、金额、日期或状态无效的销售数据')
      const counts = { sales: countRows(db, moduleId, 'sales'), ocrConfig: 0, ocrHistory: 0 }
      if (tableExists(db, 'sale_items')) {
        requireColumns(db, 'sale_items', ['id', 'sale_id', 'name', 'qty', 'unit_price', 'subtotal', 'created_at'])
        counts.saleItems = countRows(db, moduleId, 'sale_items')
      }
      if (tableExists(db, 'ocr_config')) {
        requireColumns(db, 'ocr_config', ['id', 'ciphertext', 'iv', 'auth_tag', 'version', 'updated_at'])
        counts.ocrConfig = countRows(db, moduleId, 'ocr_config')
        const config = db.prepare('SELECT * FROM ocr_config').all()
        if (config.some(row => row.id !== 1 || !Number.isSafeInteger(row.version) || row.version < 1
          || hasBlankText(row.ciphertext, 10000) || hasBlankText(row.iv, 1000) || hasBlankText(row.auth_tag, 1000)
          || !isValidTimestamp(row.updated_at))) throw persistenceError('OCR 配置记录无效')
      }
      if (tableExists(db, 'ocr_history')) {
        requireColumns(db, 'ocr_history', ['id', 'request_id', 'status', 'amount', 'matched_text', 'words_count', 'recognized_text', 'error_code', 'http_status', 'error_message', 'duration_ms', 'created_at'], ['structured_json'])
        counts.ocrHistory = countRows(db, moduleId, 'ocr_history')
        const invalidHistory = hasInvalidRow(db.prepare('SELECT id, request_id, status, amount, words_count, duration_ms, created_at FROM ocr_history'), row => !Number.isSafeInteger(row.id) || row.id <= 0
          || hasBlankText(row.request_id, 1000) || !['success', 'failure', 'cancelled'].includes(row.status)
          || (row.amount !== null && (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0))
          || !Number.isSafeInteger(row.words_count) || row.words_count < 0 || !Number.isSafeInteger(row.duration_ms) || row.duration_ms < 0
          || !isValidTimestamp(row.created_at))
        const duplicateHistory = db.prepare('SELECT 1 FROM ocr_history GROUP BY id HAVING COUNT(*) > 1 UNION ALL SELECT 1 FROM ocr_history GROUP BY request_id HAVING COUNT(*) > 1 LIMIT 1').get()
        if (invalidHistory || duplicateHistory) throw persistenceError('OCR 历史记录包含重复或无效数据')
      }
      if (tableExists(db, 'ocr_usage')) {
        requireColumns(db, 'ocr_usage', ['id', 'request_id', 'attempt_no', 'billing_month', 'created_at'])
        counts.ocrUsage = countRows(db, moduleId, 'ocr_usage')
        const invalidUsage = hasInvalidRow(db.prepare('SELECT id, request_id, attempt_no, billing_month, created_at FROM ocr_usage'), row => !Number.isSafeInteger(row.id) || row.id <= 0
          || hasBlankText(row.request_id, 128) || !Number.isSafeInteger(row.attempt_no) || row.attempt_no < 1 || row.attempt_no > 10
          || !isValidOcrBillingMonth(row.billing_month) || !isValidTimestamp(row.created_at))
        const duplicateUsage = db.prepare('SELECT 1 FROM ocr_usage GROUP BY id HAVING COUNT(*) > 1 UNION ALL SELECT 1 FROM ocr_usage GROUP BY request_id, attempt_no HAVING COUNT(*) > 1 LIMIT 1').get()
        if (invalidUsage || duplicateUsage) throw persistenceError('OCR 调用次数记录包含重复或无效数据')
      }
      return counts
    }
    throw persistenceError(`未知持久化模块：${moduleId}`)
  } finally {
    db.close()
  }
}

function fingerprint(key) {
  return crypto.createHash('sha256').update(key).digest('hex')
}

function readOcrConfigRow(databasePath) {
  const db = openCandidate(databasePath)
  try {
    if (!tableExists(db, 'ocr_config')) return null
    return db.prepare('SELECT * FROM ocr_config WHERE id = 1').get() || null
  } finally {
    db.close()
  }
}

function sourceOcrKey(manifest, extracted) {
  const mode = manifest.ocrEncryption.mode
  if (mode === 'local') return loadOrCreateLocalKey(extracted.get('receipt-assistant.ocr-key'), { create: false })
  if (mode === 'environment') {
    const key = decodeEnvironmentKey(process.env.OCR_CONFIG_ENCRYPTION_KEY)
    if (!key || fingerprint(key) !== manifest.ocrEncryption.fingerprint) {
      throw persistenceError('当前服务器的 OCR_CONFIG_ENCRYPTION_KEY 与备份不匹配')
    }
    return key
  }
  return null
}

function validateOcrPair(manifest, extracted) {
  const row = readOcrConfigRow(extracted.get('receipt-assistant.database'))
  if (!row) {
    if (manifest.ocrEncryption.mode !== 'none') throw persistenceError('备份声明了 OCR 密钥，但数据库没有 OCR 配置')
    return null
  }
  const key = sourceOcrKey(manifest, extracted)
  if (!key) throw persistenceError('备份包含 OCR 配置，但缺少配套加密密钥')
  decryptOcrCredentials(row, key)
  return row
}

function assertManifestCounts(manifest, moduleId, actual) {
  const definition = MODULES.find(module => module.id === moduleId)
  const declared = manifest.entries.find(entry => entry.id === definition.entryId)?.counts
  for (const [name, count] of Object.entries(actual)) {
    if (declared?.[name] !== count) throw persistenceError(`${definition.name}的记录统计与备份清单不一致`)
  }
}

function resetSequence(db, table) {
  if (tableExists(db, 'sqlite_sequence')) db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table)
}

function restoreComputer(sourcePath, targetDb) {
  const source = openCandidate(sourcePath)
  const P = name => tableName('computer-labels', name)
  try {
    const hasAddedDate = source.prepare('PRAGMA table_info(products)').all().some(column => column.name === 'added_date')
    const sourceColumns = hasAddedDate
      ? 'id, name, config, color, sku, remark, added_date, created_at, updated_at'
      : 'id, name, config, color, sku, remark, created_at, updated_at'
    const insert = targetDb.prepare(`INSERT INTO ${P('products')} (id, name, config, color, sku, remark, added_date, created_at, updated_at) VALUES (@id, @name, @config, @color, @sku, @remark, @added_date, @created_at, @updated_at)`)
    targetDb.transaction(() => {
      targetDb.prepare(`DELETE FROM ${P('products')}`).run()
      resetSequence(targetDb, P('products'))
      for (const row of source.prepare(`SELECT ${sourceColumns} FROM products ORDER BY id`).iterate()) {
        insert.run({ ...row, added_date: normalizeAddedDate(row.added_date, row.created_at) })
      }
    })()
  } finally {
    source.close()
  }
}

function restorePrice(sourcePath, targetDb) {
  const source = openCandidate(sourcePath)
  const P = name => tableName('price-labels', name)
  try {
    const hasAddedDate = source.prepare('PRAGMA table_info(products)').all().some(column => column.name === 'added_date')
    const sourceColumns = hasAddedDate
      ? 'id, name, category, price, added_date, created_at, updated_at'
      : 'id, name, category, price, created_at, updated_at'
    const insertCategory = targetDb.prepare(`INSERT INTO ${P('categories')} (id, name, sort_order) VALUES (@id, @name, @sort_order)`)
    const insertProduct = targetDb.prepare(`INSERT INTO ${P('products')} (id, name, category, price, added_date, created_at, updated_at) VALUES (@id, @name, @category, @price, @added_date, @created_at, @updated_at)`)
    targetDb.transaction(() => {
      targetDb.prepare(`DELETE FROM ${P('products')}`).run()
      targetDb.prepare(`DELETE FROM ${P('categories')}`).run()
      resetSequence(targetDb, P('products'))
      resetSequence(targetDb, P('categories'))
      for (const row of source.prepare('SELECT id, name, sort_order FROM categories ORDER BY id').iterate()) insertCategory.run(row)
      for (const row of source.prepare(`SELECT ${sourceColumns} FROM products ORDER BY id`).iterate()) {
        insertProduct.run({ ...row, added_date: normalizeAddedDate(row.added_date, row.created_at) })
      }
      if (targetDb.prepare('PRAGMA foreign_key_check').all().length) throw persistenceError('恢复后的价签数据未通过外键检查')
    })()
  } finally {
    source.close()
  }
}

function restoreReceipt(sourcePath, targetDb, manifest, extracted, ocrKeyPath) {
  const source = openCandidate(sourcePath)
  const P = name => tableName('receipt-assistant', name)
  try {
    createOcrStorage({ db: targetDb, keyFilePath: ocrKeyPath, environmentKey: process.env.OCR_CONFIG_ENCRYPTION_KEY })
    const sourceConfig = tableExists(source, 'ocr_config') ? source.prepare('SELECT * FROM ocr_config WHERE id = 1').get() : null
    let restoredConfig = null
    if (sourceConfig) {
      const credentials = decryptOcrCredentials(sourceConfig, sourceOcrKey(manifest, extracted))
      const targetKey = decodeEnvironmentKey(process.env.OCR_CONFIG_ENCRYPTION_KEY) || loadOrCreateLocalKey(ocrKeyPath)
      restoredConfig = { ...sourceConfig, ...encryptOcrCredentials(credentials, targetKey) }
    }
    const insertSale = targetDb.prepare(`INSERT INTO ${P('sales')} (id, sale_date, amount, status, created_at) VALUES (@id, @sale_date, @amount, @status, @created_at)`)
    const insertSaleItem = targetDb.prepare(`INSERT INTO ${P('sale_items')} (id, sale_id, name, qty, unit_price, subtotal, created_at) VALUES (@id, @sale_id, @name, @qty, @unit_price, @subtotal, @created_at)`)
    const insertHistory = targetDb.prepare(`INSERT INTO ${P('ocr_history')} (id, request_id, status, amount, matched_text, words_count, recognized_text, structured_json, error_code, http_status, error_message, duration_ms, created_at) VALUES (@id, @request_id, @status, @amount, @matched_text, @words_count, @recognized_text, @structured_json, @error_code, @http_status, @error_message, @duration_ms, @created_at)`)
    const mergeUsage = targetDb.prepare(`INSERT OR IGNORE INTO ${P('ocr_usage')} (request_id, attempt_no, billing_month, created_at) VALUES (@request_id, @attempt_no, @billing_month, @created_at)`)
    const insertConfig = targetDb.prepare(`INSERT INTO ${P('ocr_config')} (id, ciphertext, iv, auth_tag, version, updated_at) VALUES (@id, @ciphertext, @iv, @authTag, @version, @updated_at)`)
    targetDb.transaction(() => {
      targetDb.prepare(`DELETE FROM ${P('sale_items')}`).run()
      targetDb.prepare(`DELETE FROM ${P('sales')}`).run()
      targetDb.prepare(`DELETE FROM ${P('ocr_history')}`).run()
      targetDb.prepare(`DELETE FROM ${P('ocr_config')}`).run()
      resetSequence(targetDb, P('sales'))
      resetSequence(targetDb, P('sale_items'))
      resetSequence(targetDb, P('ocr_history'))
      for (const row of source.prepare('SELECT id, sale_date, amount, status, created_at FROM sales ORDER BY id').iterate()) insertSale.run(row)
      if (tableExists(source, 'sale_items')) {
        const sourceItemColumns = new Set(source.prepare('PRAGMA table_info(sale_items)').all().map(column => column.name))
        if (['id', 'sale_id', 'name', 'qty', 'unit_price', 'subtotal', 'created_at'].every(column => sourceItemColumns.has(column))) {
          for (const row of source.prepare('SELECT id, sale_id, name, qty, unit_price, subtotal, created_at FROM sale_items ORDER BY id').iterate()) insertSaleItem.run(row)
        }
      }
      if (tableExists(source, 'ocr_history')) {
        const sourceHistoryColumns = new Set(source.prepare('PRAGMA table_info(ocr_history)').all().map(column => column.name))
        const structuredSelect = sourceHistoryColumns.has('structured_json') ? 'structured_json' : 'NULL AS structured_json'
        for (const row of source.prepare(`SELECT id, request_id, status, amount, matched_text, words_count, recognized_text, ${structuredSelect}, error_code, http_status, error_message, duration_ms, created_at FROM ocr_history ORDER BY id`).iterate()) insertHistory.run(row)
      }
      if (tableExists(source, 'ocr_usage')) {
        for (const row of source.prepare('SELECT request_id, attempt_no, billing_month, created_at FROM ocr_usage ORDER BY id').iterate()) mergeUsage.run(row)
      }
      if (restoredConfig) insertConfig.run(restoredConfig)
    })()
  } finally {
    source.close()
  }
}

export function createPersistenceService({ runtimes, receiptMaintenance, ocrKeyPath }) {
  async function createBackup(outputPath, workingDirectory) {
    const backupId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const payloads = []
    // 统一数据库下所有模块共享同一个 SQLite 连接，只需快照一次，
    // 但每个模块仍按原备份格式各自打一份，保持 .lsbackup 结构不变。
    const firstModule = MODULES[0].id
    const sharedSnapshotPath = path.join(workingDirectory, 'unified.snapshot.sqlite')
    await runtimes.get(firstModule).getDatabase().backup(sharedSnapshotPath)
    for (const definition of MODULES) {
      const snapshotPath = path.join(workingDirectory, `${definition.id}.sqlite`)
      extractModuleSnapshot(sharedSnapshotPath, snapshotPath, definition.id)
      const counts = await validateDatabase(snapshotPath, definition.id)
      payloads.push({ id: definition.entryId, moduleId: definition.id, kind: 'database', path: snapshotPath, counts })
    }

    const receiptPath = payloads.find(payload => payload.moduleId === 'receipt-assistant').path
    const configRow = readOcrConfigRow(receiptPath)
    let ocrEncryption = { mode: 'none' }
    if (configRow) {
      const environmentKey = decodeEnvironmentKey(process.env.OCR_CONFIG_ENCRYPTION_KEY)
      if (environmentKey) {
        decryptOcrCredentials(configRow, environmentKey)
        ocrEncryption = { mode: 'environment', fingerprint: fingerprint(environmentKey) }
      } else {
        const localKey = loadOrCreateLocalKey(ocrKeyPath, { create: false })
        decryptOcrCredentials(configRow, localKey)
        ocrEncryption = { mode: 'local' }
        payloads.push({ id: 'receipt-assistant.ocr-key', moduleId: 'receipt-assistant', kind: 'secret', path: ocrKeyPath, counts: {} })
      }
    }
    return writeBackupPackage({ outputPath, backupId, createdAt, payloads, ocrEncryption })
  }

  async function inspect(manifest, extracted) {
    const modules = []
    for (const definition of MODULES) {
      const databasePath = extracted.get(definition.entryId)
      if (!databasePath) {
        throw persistenceError(`${definition.name}数据库未包含在备份中`)
      }
      const counts = await validateDatabase(databasePath, definition.id)
      assertManifestCounts(manifest, definition.id, counts)
      modules.push({ id: definition.id, name: definition.name, counts, present: true, status: 'ready', error: null })
    }
    try {
      validateOcrPair(manifest, extracted)
    } catch (error) {
      const receiptModule = modules.find(module => module.id === 'receipt-assistant')
      receiptModule.status = 'incompatible'
      receiptModule.error = error.message
    }
    return {
      backupId: manifest.backupId,
      createdAt: manifest.createdAt,
      formatVersion: manifest.formatVersion,
      modules,
      ocrEncryptionMode: manifest.ocrEncryption.mode,
    }
  }

  async function restore(moduleId, manifest, extracted) {
    const definition = MODULES.find(module => module.id === moduleId)
    if (!definition) throw persistenceError('不支持恢复此模块', 404, 'UNKNOWN_MODULE')
    const sourcePath = extracted.get(definition.entryId)
    if (!sourcePath) throw persistenceError(`${definition.name}数据库未包含在备份中`, 400, 'MODULE_NOT_IN_BACKUP')
    const counts = await validateDatabase(sourcePath, moduleId)
    assertManifestCounts(manifest, moduleId, counts)
    if (moduleId === 'computer-labels') restoreComputer(sourcePath, runtimes.get(moduleId).getDatabase())
    else if (moduleId === 'price-labels') restorePrice(sourcePath, runtimes.get(moduleId).getDatabase())
    else {
      validateOcrPair(manifest, extracted)
      await receiptMaintenance.runRestore(() => restoreReceipt(sourcePath, runtimes.get(moduleId).getDatabase(), manifest, extracted, ocrKeyPath))
    }
    return { moduleId, name: definition.name, counts }
  }

  return { createBackup, inspect, restore }
}
