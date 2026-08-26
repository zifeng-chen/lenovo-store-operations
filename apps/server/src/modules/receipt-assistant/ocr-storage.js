import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ENCRYPTION_CONTEXT = Buffer.from('lenovo-pos-ocr-config:v1')

function createStorageError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

export function decodeEnvironmentKey(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  const key = /^[a-f\d]{64}$/i.test(normalized) ? Buffer.from(normalized, 'hex') : Buffer.from(normalized, 'base64')
  if (key.length !== 32) throw createStorageError('OCR_CONFIG_ENCRYPTION_KEY 必须是 32 字节 Base64 或 64 位十六进制字符串', 'INVALID_ENCRYPTION_KEY')
  return key
}

export function loadOrCreateLocalKey(filePath, { create = true } = {}) {
  const directoryPath = path.dirname(filePath)
  if (!fs.existsSync(directoryPath)) {
    if (!create) throw createStorageError('本机 OCR 凭据加密密钥不存在', 'LOCAL_KEY_NOT_FOUND')
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 })
  } else {
    const stats = fs.lstatSync(directoryPath)
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw createStorageError('OCR 本机密钥目录必须是普通目录', 'INVALID_LOCAL_KEY_DIRECTORY')
  }
  if (process.platform !== 'win32') {
    if (create) fs.chmodSync(directoryPath, 0o700)
    const stats = fs.lstatSync(directoryPath)
    if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700) throw createStorageError('OCR 本机密钥目录权限必须为 0700', 'INSECURE_LOCAL_KEY_DIRECTORY_MODE')
  }
  if (!fs.existsSync(filePath)) {
    if (!create) throw createStorageError('本机 OCR 凭据加密密钥不存在', 'LOCAL_KEY_NOT_FOUND')
    try { fs.writeFileSync(filePath, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  const stats = fs.lstatSync(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) throw createStorageError('本机 OCR 凭据加密密钥必须是普通文件', 'INVALID_LOCAL_KEY_FILE')
  if (process.platform !== 'win32') {
    if (create) fs.chmodSync(filePath, 0o600)
    if ((fs.lstatSync(filePath).mode & 0o777) !== 0o600) throw createStorageError('本机 OCR 凭据加密密钥权限必须为 0600', 'INSECURE_LOCAL_KEY_MODE')
  }
  const key = fs.readFileSync(filePath)
  if (key.length !== 32) throw createStorageError('本机 OCR 凭据加密密钥无效，请恢复原密钥或重新配置凭据', 'INVALID_LOCAL_KEY')
  return key
}

export function encryptOcrCredentials(credentials, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(ENCRYPTION_CONTEXT)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }
}

export function decryptOcrCredentials(row, key) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'))
    decipher.setAAD(ENCRYPTION_CONTEXT)
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8')
    const credentials = JSON.parse(plaintext)
    if (!credentials.apiKey || !credentials.secretKey) throw new Error('Missing credentials')
    return credentials
  } catch {
    throw createStorageError('无法解密已保存的百度 OCR 凭据，请重新配置', 'OCR_CONFIG_DECRYPT_FAILED')
  }
}

function maskApiKey(apiKey) {
  const value = String(apiKey || '')
  if (!value) return ''
  if (value.length <= 8) return '•'.repeat(Math.max(4, value.length))
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`
}

function mapHistoryRow(row, includeRecognizedText = false) {
  if (!row) return null
  const result = {
    id: row.id, requestId: row.request_id, status: row.status, amount: row.amount,
    matchedText: row.matched_text, wordsCount: row.words_count, errorCode: row.error_code,
    httpStatus: row.http_status, errorMessage: row.error_message, durationMs: row.duration_ms,
    createdAt: row.created_at,
  }
  if (includeRecognizedText) result.recognizedText = row.recognized_text || ''
  return result
}

export function createOcrStorage({ db, keyFilePath, environmentKey } = {}) {
  if (!db) throw new Error('OCR storage requires a database')
  db.exec(`
    CREATE TABLE IF NOT EXISTS ocr_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ocr_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'cancelled')),
      amount REAL,
      matched_text TEXT,
      words_count INTEGER NOT NULL DEFAULT 0,
      recognized_text TEXT,
      error_code TEXT,
      http_status INTEGER,
      error_message TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_ocr_history_created_at
      ON ocr_history (created_at DESC, id DESC);
  `)

  let encryptionKey = decodeEnvironmentKey(environmentKey)
  const getEncryptionKey = () => encryptionKey || (encryptionKey = loadOrCreateLocalKey(keyFilePath))
  const getCredentialRow = () => db.prepare('SELECT * FROM ocr_config WHERE id = 1').get()

  function encryptCredentials(credentials) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
    cipher.setAAD(ENCRYPTION_CONTEXT)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()])
    return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }
  }

  function decryptCredentials(row) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(row.iv, 'base64'))
      decipher.setAAD(ENCRYPTION_CONTEXT)
      decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'))
      const plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8')
      const credentials = JSON.parse(plaintext)
      if (!credentials.apiKey || !credentials.secretKey) throw new Error('Missing credentials')
      return credentials
    } catch {
      throw createStorageError('无法解密已保存的百度 OCR 凭据，请重新配置', 'OCR_CONFIG_DECRYPT_FAILED')
    }
  }

  function loadCredentials() {
    const row = getCredentialRow()
    if (!row) return null
    return { ...decryptCredentials(row), version: row.version, updatedAt: row.updated_at }
  }

  function getCredentialMetadata() {
    const row = db.prepare('SELECT version, updated_at FROM ocr_config WHERE id = 1').get()
    return row ? { version: row.version, updatedAt: row.updated_at } : { version: 0, updatedAt: null }
  }

  const saveCredentials = db.transaction(({ apiKey, secretKey, expectedVersion }) => {
    const row = getCredentialRow()
    if (expectedVersion !== (row?.version || 0)) {
      const error = createStorageError('OCR 配置已被其他操作更新，请刷新后重试', 'OCR_CONFIG_VERSION_CONFLICT')
      error.status = 409
      throw error
    }
    const encrypted = encryptCredentials({ apiKey, secretKey })
    if (row) db.prepare("UPDATE ocr_config SET ciphertext = ?, iv = ?, auth_tag = ?, version = version + 1, updated_at = datetime('now') WHERE id = 1").run(encrypted.ciphertext, encrypted.iv, encrypted.authTag)
    else db.prepare('INSERT INTO ocr_config (id, ciphertext, iv, auth_tag, version) VALUES (1, ?, ?, ?, 1)').run(encrypted.ciphertext, encrypted.iv, encrypted.authTag)
    return loadCredentials()
  })

  const insertHistoryStatement = db.prepare(`INSERT INTO ocr_history (request_id, status, amount, matched_text, words_count, recognized_text, error_code, http_status, error_message, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  function insertHistory(entry) {
    const result = insertHistoryStatement.run(entry.requestId, entry.status, entry.amount ?? null, entry.matchedText || null, Number(entry.wordsCount) || 0, entry.recognizedText ? String(entry.recognizedText).slice(0, 100000) : null, entry.errorCode || null, entry.httpStatus || null, entry.errorMessage ? String(entry.errorMessage).slice(0, 1000) : null, Math.max(0, Math.round(Number(entry.durationMs) || 0)))
    return Number(result.lastInsertRowid)
  }

  function listHistory({ page, pageSize }) {
    const total = db.prepare('SELECT COUNT(*) AS count FROM ocr_history').get().count
    const rows = db.prepare('SELECT id, request_id, status, amount, matched_text, words_count, error_code, http_status, error_message, duration_ms, created_at FROM ocr_history ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize)
    return { items: rows.map(row => mapHistoryRow(row)), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  }

  return {
    loadCredentials,
    saveCredentials,
    getConfigStatus(credentials, source, storageError = false) {
      const metadata = getCredentialMetadata()
      return { configured: Boolean(credentials?.apiKey && credentials?.secretKey), apiKeyMasked: maskApiKey(credentials?.apiKey), hasSecretKey: Boolean(credentials?.secretKey), source, version: metadata.version, updatedAt: metadata.updatedAt, storageError }
    },
    insertHistory,
    listHistory,
    getHistoryById(id) { return mapHistoryRow(db.prepare('SELECT * FROM ocr_history WHERE id = ?').get(id), true) },
  }
}
