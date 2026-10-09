import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import {
  PRICE_PLACARDS_DATA_DIR,
  PRICE_PLACARDS_DATABASE_PATH,
} from '../../config/data-paths.js'
import {
  DATABASE_SCHEMA_VERSION,
  MAX_ASSETS_PER_VERSION,
  MAX_IMAGE_ASSETS,
  MAX_PLACARDS,
  MAX_SERVICE_CATALOG,
  MAX_TOTAL_IMAGE_BYTES,
  MAX_VERSIONS_PER_PLACARD,
  SCHEMA_VERSION,
  collectAssetIds,
  inspectImageBuffer,
  isPositiveSafeInteger,
  isRecord,
  isValidTimestamp,
  validateDecodedImage,
  validatePlacardPayload,
  validateServiceCatalogItem,
} from './validation.js'
import {
  installDatabaseFile,
  recoverDatabaseRestore,
} from './restore-transaction.js'

const databaseDirectory = PRICE_PLACARDS_DATA_DIR
export const DATABASE_PATH = PRICE_PLACARDS_DATABASE_PATH
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000
let database
let restoreInProgress = false

function fsyncPath(filePath) {
  const descriptor = fs.openSync(filePath, 'r')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function fsyncParentDirectory(filePath) {
  fsyncPath(path.dirname(filePath))
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS placards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      current_version_id INTEGER REFERENCES placard_versions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS placard_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      placard_id INTEGER NOT NULL REFERENCES placards(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK(version_number > 0),
      content_json TEXT NOT NULL,
      source_snapshots_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(placard_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS image_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sha256 TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      width INTEGER NOT NULL CHECK(width > 0 AND width <= 1200),
      height INTEGER NOT NULL CHECK(height > 0 AND height <= 1200),
      byte_length INTEGER NOT NULL CHECK(byte_length > 0 AND byte_length <= 1048576),
      data BLOB NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS version_assets (
      version_id INTEGER NOT NULL REFERENCES placard_versions(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES image_assets(id) ON DELETE RESTRICT,
      PRIMARY KEY(version_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS image_claim_sessions (
      token TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS image_asset_claims (
      token TEXT NOT NULL REFERENCES image_claim_sessions(token) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES image_assets(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      PRIMARY KEY(token, asset_id)
    );

    CREATE TABLE IF NOT EXISTS service_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      price INTEGER NOT NULL CHECK(price >= 1 AND price <= 999999),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_price_placards_updated_at ON placards(updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_price_placard_versions_placard ON placard_versions(placard_id, version_number DESC);
    CREATE INDEX IF NOT EXISTS idx_price_placard_version_assets_asset ON version_assets(asset_id);
    CREATE INDEX IF NOT EXISTS idx_price_placard_claims_asset_expiry ON image_asset_claims(asset_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_price_placard_claims_expiry ON image_asset_claims(expires_at);
    CREATE INDEX IF NOT EXISTS idx_price_placard_service_catalog_name ON service_catalog(name);

    CREATE TRIGGER IF NOT EXISTS trg_price_placard_versions_immutable
    BEFORE UPDATE ON placard_versions
    BEGIN
      SELECT RAISE(ABORT, 'placard versions are immutable');
    END;
  `)
  db.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`)
}

function configureDatabase(db, { enableWal = true } = {}) {
  db.pragma('trusted_schema = OFF')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  if (enableWal) db.pragma('journal_mode = WAL')
}

function openDatabase({ skipRecovery = false } = {}) {
  fs.mkdirSync(databaseDirectory, { recursive: true })
  if (!skipRecovery) {
    recoverDatabaseRestore({
      directory: databaseDirectory,
      databasePath: DATABASE_PATH,
      validateSync: validateDatabaseContainerSync,
    })
  }
  const hasExistingDatabase = fs.existsSync(DATABASE_PATH) && fs.statSync(DATABASE_PATH).size > 0
  const db = new Database(DATABASE_PATH)
  try {
    configureDatabase(db, { enableWal: false })
    if (hasExistingDatabase) {
      migrateSchema(db)
      validateSchema(db)
      validateDataset(db)
    } else {
      createSchema(db)
      validateSchema(db)
      validateDataset(db)
    }
    configureDatabase(db)
    if (hasExistingDatabase) cleanupOrphanImages(db)
    database = db
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function initializeDatabase() {
  if (restoreInProgress && !database?.open) throw new Error('数据库恢复正在进行')
  return database?.open ? database : openDatabase()
}

export function getDatabase() {
  if (restoreInProgress && !database?.open) throw new Error('数据库恢复正在进行')
  return database?.open ? database : openDatabase()
}

export function closeDatabase() {
  if (!database?.open) { database = undefined; return }
  const activeDatabase = database
  database = undefined
  try {
    activeDatabase.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    if (!['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error?.code)) throw error
  } finally {
    activeDatabase.close()
  }
}

function closeDatabaseStrict() {
  if (!database?.open) return
  const checkpoint = new Database(DATABASE_PATH, { fileMustExist: true })
  let result
  try {
    checkpoint.pragma('busy_timeout = 5000')
    result = checkpoint.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    checkpoint.close()
  }
  if (result.some(row => Number(row.busy) !== 0)) {
    const error = new Error('数据库 WAL checkpoint 正忙，恢复已中止')
    error.code = 'SQLITE_BUSY'
    throw error
  }
  const active = database
  database = undefined
  active.close()
}

function parseVersionRow(row) {
  if (!row) return null
  return {
    id: row.id,
    placardId: row.placard_id,
    versionNumber: row.version_number,
    content: JSON.parse(row.content_json),
    sourceSnapshots: JSON.parse(row.source_snapshots_json),
    createdAt: row.created_at,
  }
}

function assertClaimToken(token) {
  if (typeof token !== 'string' || !UUID_PATTERN.test(token)) throw new Error('claimToken 必须是有效 UUID')
  return token
}

function cleanupClaimsAndOrphans(db = getDatabase()) {
  const now = new Date().toISOString()
  return db.transaction(() => {
    db.prepare('DELETE FROM image_asset_claims WHERE expires_at <= ?').run(now)
    db.prepare('DELETE FROM image_claim_sessions WHERE expires_at <= ?').run(now)
    return db.prepare(`DELETE FROM image_assets
      WHERE NOT EXISTS (SELECT 1 FROM version_assets WHERE asset_id = image_assets.id)
        AND NOT EXISTS (SELECT 1 FROM image_asset_claims WHERE asset_id = image_assets.id AND expires_at > ?)`)
      .run(now).changes
  })()
}

export function createImageClaim() {
  const db = getDatabase()
  cleanupClaimsAndOrphans(db)
  const claimToken = randomUUID()
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString()
  db.prepare('INSERT INTO image_claim_sessions (token, expires_at) VALUES (?, ?)').run(claimToken, expiresAt)
  return { claimToken, expiresAt }
}

function requireActiveClaim(db, claimToken) {
  assertClaimToken(claimToken)
  const row = db.prepare('SELECT expires_at FROM image_claim_sessions WHERE token = ? AND expires_at > ?').get(claimToken, new Date().toISOString())
  if (!row) throw new Error('图片 claim 不存在或已过期')
  return row
}

export function releaseImageClaim(claimToken, assetId = null) {
  const db = getDatabase()
  assertClaimToken(claimToken)
  return db.transaction(() => {
    const result = assetId == null
      ? db.prepare('DELETE FROM image_claim_sessions WHERE token = ?').run(claimToken)
      : db.prepare('DELETE FROM image_asset_claims WHERE token = ? AND asset_id = ?').run(claimToken, assetId)
    cleanupClaimsAndOrphans(db)
    return Boolean(result.changes)
  })()
}

function assertAssetsAvailable(db, assetIds, claimToken) {
  const now = new Date().toISOString()
  const select = db.prepare(`SELECT i.id,
    EXISTS(SELECT 1 FROM version_assets va WHERE va.asset_id = i.id) AS historical,
    EXISTS(SELECT 1 FROM image_asset_claims c WHERE c.asset_id = i.id AND c.token = ? AND c.expires_at > ?) AS claimed
    FROM image_assets i WHERE i.id = ?`)
  for (const id of assetIds) {
    const row = select.get(claimToken ?? '', now, id)
    if (!row) throw new Error(`图片 ${id} 不存在`)
    if (!row.historical && !row.claimed) throw new Error(`图片 ${id} 必须由当前 claimToken 认领`)
  }
}

function consumeClaim(db, claimToken) {
  if (claimToken == null) return
  requireActiveClaim(db, claimToken)
  db.prepare('DELETE FROM image_claim_sessions WHERE token = ?').run(claimToken)
}

function insertVersion(db, placardId, versionNumber, validated, createdAt = new Date().toISOString(), claimToken = null) {
  const assetIds = collectAssetIds(validated.content)
  assertAssetsAvailable(db, assetIds, claimToken)
  const result = db.prepare(`
    INSERT INTO placard_versions (placard_id, version_number, content_json, source_snapshots_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(placardId, versionNumber, JSON.stringify(validated.content), JSON.stringify(validated.sourceSnapshots), createdAt)
  const versionId = Number(result.lastInsertRowid)
  const link = db.prepare('INSERT INTO version_assets (version_id, asset_id) VALUES (?, ?)')
  assetIds.forEach((assetId) => link.run(versionId, assetId))
  consumeClaim(db, claimToken)
  cleanupClaimsAndOrphans(db)
  return versionId
}

export function listPlacards() {
  return getDatabase().prepare(`
    SELECT p.id, p.title, p.current_version_id AS currentVersionId,
           v.version_number AS versionNumber, p.created_at AS createdAt, p.updated_at AS updatedAt
    FROM placards p
    JOIN placard_versions v ON v.id = p.current_version_id
    ORDER BY p.updated_at DESC, p.id DESC
  `).all()
}

export function listServiceCatalog() {
  return getDatabase().prepare(`
    SELECT id, name, price, created_at AS createdAt, updated_at AS updatedAt
    FROM service_catalog ORDER BY name COLLATE NOCASE, id
  `).all()
}

export function createServiceCatalogItem(payload) {
  const validated = validateServiceCatalogItem(payload)
  const db = getDatabase()
  return db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) AS count FROM service_catalog').get().count >= MAX_SERVICE_CATALOG) throw new Error(`服务库不能超过 ${MAX_SERVICE_CATALOG} 项`)
    const now = new Date().toISOString()
    const result = db.prepare('INSERT INTO service_catalog (name, price, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(validated.name, validated.price, now, now)
    return db.prepare('SELECT id, name, price, created_at AS createdAt, updated_at AS updatedAt FROM service_catalog WHERE id = ?')
      .get(Number(result.lastInsertRowid))
  })()
}

export function updateServiceCatalogItem(id, payload) {
  const validated = validateServiceCatalogItem(payload)
  const db = getDatabase()
  const result = db.prepare('UPDATE service_catalog SET name = ?, price = ?, updated_at = ? WHERE id = ?')
    .run(validated.name, validated.price, new Date().toISOString(), id)
  if (!result.changes) return null
  return db.prepare('SELECT id, name, price, created_at AS createdAt, updated_at AS updatedAt FROM service_catalog WHERE id = ?').get(id)
}

export function deleteServiceCatalogItem(id) {
  return Boolean(getDatabase().prepare('DELETE FROM service_catalog WHERE id = ?').run(id).changes)
}

export function upsertServiceCatalog(items) {
  if (!Array.isArray(items)) throw new Error('服务库导入数据必须是数组')
  const unique = new Map(items.map((item) => {
    const validated = validateServiceCatalogItem(item)
    return [validated.name, validated]
  }))
  if (unique.size > MAX_SERVICE_CATALOG) throw new Error(`服务库不能超过 ${MAX_SERVICE_CATALOG} 项`)
  const db = getDatabase()
  return db.transaction(() => {
    const existing = new Set(db.prepare('SELECT name FROM service_catalog').all().map((row) => row.name))
    const inserted = [...unique.keys()].filter((name) => !existing.has(name)).length
    if (existing.size + inserted > MAX_SERVICE_CATALOG) throw new Error(`服务库不能超过 ${MAX_SERVICE_CATALOG} 项`)
    const now = new Date().toISOString()
    const upsert = db.prepare(`INSERT INTO service_catalog (name, price, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at`)
    unique.forEach((item) => upsert.run(item.name, item.price, now, now))
    return { total: unique.size, inserted, updated: unique.size - inserted, services: listServiceCatalog() }
  })()
}

export function getPlacardDetail(id) {
  const db = getDatabase()
  const placard = db.prepare('SELECT id, title, current_version_id, created_at, updated_at FROM placards WHERE id = ?').get(id)
  if (!placard) return null
  const version = parseVersionRow(db.prepare('SELECT * FROM placard_versions WHERE id = ? AND placard_id = ?').get(placard.current_version_id, id))
  return { id: placard.id, title: placard.title, currentVersionId: placard.current_version_id, createdAt: placard.created_at, updatedAt: placard.updated_at, version }
}

export function createPlacard(payload, claimToken = null, { preserveHistoricalContent = false } = {}) {
  const db = getDatabase()
  const validated = validatePlacardPayload(payload, preserveHistoricalContent
    ? {}
    : { syncTitle: true, enforceAccessoryVisibility: true, enforceFeatureTextLimit: true })
  return db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) AS count FROM placards').get().count >= MAX_PLACARDS) throw new Error(`当前展牌不能超过 ${MAX_PLACARDS} 张`)
    const now = new Date().toISOString()
    const result = db.prepare('INSERT INTO placards (title, current_version_id, created_at, updated_at) VALUES (?, NULL, ?, ?)').run(validated.content.title, now, now)
    const placardId = Number(result.lastInsertRowid)
    const versionId = insertVersion(db, placardId, 1, validated, now, claimToken)
    db.prepare('UPDATE placards SET current_version_id = ? WHERE id = ?').run(versionId, placardId)
    return getPlacardDetail(placardId)
  })()
}

export function updatePlacard(id, payload, claimToken = null) {
  const db = getDatabase()
  const validated = validatePlacardPayload(payload, { syncTitle: true, enforceAccessoryVisibility: true, enforceFeatureTextLimit: true })
  return db.transaction(() => {
    const current = db.prepare(`
      SELECT p.current_version_id, v.version_number, v.content_json, v.source_snapshots_json
      FROM placards p JOIN placard_versions v ON v.id = p.current_version_id WHERE p.id = ?
    `).get(id)
    if (!current) return null
    const contentJson = JSON.stringify(validated.content)
    const sourcesJson = JSON.stringify(validated.sourceSnapshots)
    if (current.content_json === contentJson && current.source_snapshots_json === sourcesJson) {
      consumeClaim(db, claimToken)
      cleanupClaimsAndOrphans(db)
      return { ...getPlacardDetail(id), changed: false }
    }
    if (current.version_number >= MAX_VERSIONS_PER_PLACARD) throw new Error(`每张展牌最多保存 ${MAX_VERSIONS_PER_PLACARD} 个版本`)
    const now = new Date().toISOString()
    const versionId = insertVersion(db, id, current.version_number + 1, validated, now, claimToken)
    db.prepare('UPDATE placards SET title = ?, current_version_id = ?, updated_at = ? WHERE id = ?').run(validated.content.title, versionId, now, id)
    return { ...getPlacardDetail(id), changed: true }
  })()
}

export function listPlacardVersions(placardId) {
  return getDatabase().prepare(`
    SELECT id, placard_id AS placardId, version_number AS versionNumber, created_at AS createdAt
    FROM placard_versions WHERE placard_id = ? ORDER BY version_number DESC
  `).all(placardId)
}

export function getPlacardVersion(placardId, versionId) {
  return parseVersionRow(getDatabase().prepare('SELECT * FROM placard_versions WHERE id = ? AND placard_id = ?').get(versionId, placardId))
}

export function restorePlacardVersion(placardId, versionId) {
  const db = getDatabase()
  return db.transaction(() => {
    const source = getPlacardVersion(placardId, versionId)
    if (!source) return null
    const current = db.prepare(`SELECT v.version_number FROM placards p JOIN placard_versions v ON v.id = p.current_version_id WHERE p.id = ?`).get(placardId)
    if (!current) return null
    if (current.version_number >= MAX_VERSIONS_PER_PLACARD) throw new Error(`每张展牌最多保存 ${MAX_VERSIONS_PER_PLACARD} 个版本`)
    const validated = validatePlacardPayload(
      { content: source.content, sourceSnapshots: source.sourceSnapshots },
      { syncTitle: true, enforceAccessoryVisibility: true, enforceFeatureTextLimit: true },
    )
    const now = new Date().toISOString()
    const nextVersionId = insertVersion(db, placardId, current.version_number + 1, validated, now)
    db.prepare('UPDATE placards SET title = ?, current_version_id = ?, updated_at = ? WHERE id = ?').run(validated.content.title, nextVersionId, now, placardId)
    return getPlacardDetail(placardId)
  })()
}

export function copyPlacardVersion(placardId, versionId) {
  const source = getPlacardVersion(placardId, versionId)
  if (!source) return null
  return createPlacard(
    { content: source.content, sourceSnapshots: source.sourceSnapshots },
    null,
    { preserveHistoricalContent: true },
  )
}

export function cleanupOrphanImages(db = getDatabase()) {
  return cleanupClaimsAndOrphans(db)
}

export function deletePlacard(id) {
  const db = getDatabase()
  return db.transaction(() => {
    const existing = db.prepare('SELECT id FROM placards WHERE id = ?').get(id)
    if (!existing) return false
    db.prepare('UPDATE placards SET current_version_id = NULL WHERE id = ?').run(id)
    db.prepare('DELETE FROM placards WHERE id = ?').run(id)
    cleanupOrphanImages(db)
    return true
  })()
}

export function storeImage(image, claimToken) {
  const checked = inspectImageBuffer(image?.buffer, image?.mimeType)
  if (checked.sha256 !== image.sha256 || checked.width !== image.width || checked.height !== image.height || checked.byteLength !== image.byteLength) {
    throw new Error('图片元数据与内容不一致')
  }
  const db = getDatabase()
  return db.transaction(() => {
    requireActiveClaim(db, claimToken)
    const expiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString()
    db.prepare('UPDATE image_claim_sessions SET expires_at = ? WHERE token = ?').run(expiresAt, claimToken)
    db.prepare('UPDATE image_asset_claims SET expires_at = ? WHERE token = ?').run(expiresAt, claimToken)
    let stored = db.prepare('SELECT id, sha256, mime_type AS mimeType, width, height, byte_length AS byteLength FROM image_assets WHERE sha256 = ?').get(image.sha256)
    const deduplicated = Boolean(stored)
    if (!stored) {
      if (db.prepare('SELECT COUNT(*) AS count FROM image_assets').get().count >= MAX_IMAGE_ASSETS) throw new Error(`图片数量不能超过 ${MAX_IMAGE_ASSETS}`)
      const totalImageBytes = db.prepare('SELECT COALESCE(SUM(byte_length), 0) AS total FROM image_assets').get().total
      if (totalImageBytes + image.byteLength > MAX_TOTAL_IMAGE_BYTES) throw new Error('数据集内图片总大小不能超过 250MB')
      const result = db.prepare(`INSERT INTO image_assets (sha256, mime_type, width, height, byte_length, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(image.sha256, image.mimeType, image.width, image.height, image.byteLength, image.buffer, new Date().toISOString())
      stored = { id: Number(result.lastInsertRowid), sha256: image.sha256, mimeType: image.mimeType, width: image.width, height: image.height, byteLength: image.byteLength }
    }
    db.prepare(`INSERT INTO image_asset_claims (token, asset_id, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(token, asset_id) DO UPDATE SET expires_at = excluded.expires_at`).run(claimToken, stored.id, expiresAt)
    return { ...stored, deduplicated }
  })()
}

export function getImage(id) {
  return getDatabase().prepare('SELECT id, sha256, mime_type AS mimeType, byte_length AS byteLength, data FROM image_assets WHERE id = ?').get(id) || null
}

export function deleteUnusedImage(id) {
  const db = getDatabase()
  const result = db.prepare(`DELETE FROM image_assets WHERE id = ?
    AND NOT EXISTS (SELECT 1 FROM version_assets WHERE asset_id = ?)
    AND NOT EXISTS (SELECT 1 FROM image_asset_claims WHERE asset_id = ? AND expires_at > ?)`)
    .run(id, id, id, new Date().toISOString())
  return Boolean(result.changes)
}

const EXPECTED_COLUMNS = Object.freeze({
  placards: [
    ['id', 'INTEGER', 0, 1], ['title', 'TEXT', 1, 0], ['current_version_id', 'INTEGER', 0, 0],
    ['created_at', 'TEXT', 1, 0], ['updated_at', 'TEXT', 1, 0],
  ],
  placard_versions: [
    ['id', 'INTEGER', 0, 1], ['placard_id', 'INTEGER', 1, 0], ['version_number', 'INTEGER', 1, 0],
    ['content_json', 'TEXT', 1, 0], ['source_snapshots_json', 'TEXT', 1, 0], ['created_at', 'TEXT', 1, 0],
  ],
  image_assets: [
    ['id', 'INTEGER', 0, 1], ['sha256', 'TEXT', 1, 0], ['mime_type', 'TEXT', 1, 0],
    ['width', 'INTEGER', 1, 0], ['height', 'INTEGER', 1, 0], ['byte_length', 'INTEGER', 1, 0],
    ['data', 'BLOB', 1, 0], ['created_at', 'TEXT', 1, 0],
  ],
  version_assets: [['version_id', 'INTEGER', 1, 1], ['asset_id', 'INTEGER', 1, 2]],
  image_claim_sessions: [['token', 'TEXT', 0, 1], ['expires_at', 'TEXT', 1, 0]],
  image_asset_claims: [['token', 'TEXT', 1, 1], ['asset_id', 'INTEGER', 1, 2], ['expires_at', 'TEXT', 1, 0]],
  service_catalog: [
    ['id', 'INTEGER', 0, 1], ['name', 'TEXT', 1, 0], ['price', 'INTEGER', 1, 0],
    ['created_at', 'TEXT', 1, 0], ['updated_at', 'TEXT', 1, 0],
  ],
})

function validateVersionOneSchema(candidate) {
  if (candidate.pragma('user_version', { simple: true }) !== 1) throw new Error('数据库版本不是可迁移的 v1')
  const objects = candidate.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all()
  const tables = objects.filter(item => item.type === 'table').map(item => item.name).sort()
  const expectedTables = ['image_assets', 'placard_versions', 'placards', 'version_assets']
  if (JSON.stringify(tables) !== JSON.stringify(expectedTables) || objects.some(item => item.type === 'view')) throw new Error('v1 数据库表结构不兼容')
  for (const tableName of expectedTables) {
    const expected = EXPECTED_COLUMNS[tableName]
    const actual = candidate.prepare(`PRAGMA table_info(${tableName})`).all()
    if (actual.length !== expected.length || actual.some((column, index) => {
      const [name, type, notnull, pk] = expected[index]
      return column.name !== name || column.type.toUpperCase() !== type || column.notnull !== notnull || column.pk !== pk || column.dflt_value !== null
    })) throw new Error(`${tableName} v1 表结构不兼容`)
  }
  const expectedIndexes = {
    idx_price_placard_version_assets_asset: ['asset_id'],
    idx_price_placard_versions_placard: ['placard_id', 'version_number'],
    idx_price_placards_updated_at: ['updated_at', 'id'],
  }
  const indexes = objects.filter(item => item.type === 'index').map(item => item.name).sort()
  if (JSON.stringify(indexes) !== JSON.stringify(Object.keys(expectedIndexes).sort())) throw new Error('v1 数据库索引结构不兼容')
  for (const [name, columns] of Object.entries(expectedIndexes)) {
    if (JSON.stringify(candidate.prepare(`PRAGMA index_info(${name})`).all().map(row => row.name)) !== JSON.stringify(columns)) throw new Error(`${name} v1 索引不兼容`)
  }
  const expectedForeignKeys = {
    placards: ['current_version_id:placard_versions:id:SET NULL'],
    placard_versions: ['placard_id:placards:id:CASCADE'],
    image_assets: [],
    version_assets: ['asset_id:image_assets:id:RESTRICT', 'version_id:placard_versions:id:CASCADE'],
  }
  for (const [tableName, expected] of Object.entries(expectedForeignKeys)) {
    const actual = candidate.prepare(`PRAGMA foreign_key_list(${tableName})`).all().map(row => `${row.from}:${row.table}:${row.to}:${row.on_delete}`).sort()
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error(`${tableName} v1 外键不兼容`)
  }
  const imageSql = objects.find(item => item.type === 'table' && item.name === 'image_assets')?.sql ?? ''
  const checks = [...imageSql.matchAll(/CHECK\s*\(([^()]*)\)/gi)].map(match => match[1].replace(/\s+/g, '').toLowerCase()).sort()
  if (JSON.stringify(checks) !== JSON.stringify(['byte_length>0andbyte_length<=1048576', 'height>0andheight<=1200', 'width>0andwidth<=1200'])) throw new Error('image_assets v1 CHECK 约束不兼容')
  const hasUnique = (tableName, columns) => candidate.prepare(`PRAGMA index_list(${tableName})`).all().some(index => index.unique
    && JSON.stringify(candidate.prepare(`PRAGMA index_info(${index.name})`).all().map(row => row.name)) === JSON.stringify(columns))
  if (!hasUnique('placard_versions', ['placard_id', 'version_number'])
      || !hasUnique('image_assets', ['sha256'])
      || !hasUnique('version_assets', ['version_id', 'asset_id'])) throw new Error('v1 数据库唯一约束不兼容')
  const triggers = objects.filter(item => item.type === 'trigger')
  if (triggers.length !== 1 || triggers[0].name !== 'trg_price_placard_versions_immutable'
      || !/BEFORE\s+UPDATE\s+ON\s+placard_versions/i.test(triggers[0].sql ?? '')
      || !/RAISE\s*\(\s*ABORT\s*,\s*'placard versions are immutable'\s*\)/i.test(triggers[0].sql ?? '')) throw new Error('v1 数据库触发器不兼容')
}

function migrateSchema(candidate) {
  const version = candidate.pragma('user_version', { simple: true })
  if (version === DATABASE_SCHEMA_VERSION) return
  if (version === 1) validateVersionOneSchema(candidate)
  else if (version === 2) validateSchema(candidate, { expectedVersion: 2 })
  else throw new Error(`数据库版本 ${version} 不可迁移`)

  candidate.transaction(() => {
    if (version === 1) {
      candidate.exec(`
        CREATE TABLE image_claim_sessions (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
        CREATE TABLE image_asset_claims (
          token TEXT NOT NULL REFERENCES image_claim_sessions(token) ON DELETE CASCADE,
          asset_id INTEGER NOT NULL REFERENCES image_assets(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL,
          PRIMARY KEY(token, asset_id)
        );
        CREATE INDEX idx_price_placard_claims_asset_expiry ON image_asset_claims(asset_id, expires_at);
        CREATE INDEX idx_price_placard_claims_expiry ON image_asset_claims(expires_at);
      `)
    }
    candidate.exec(`
      CREATE TABLE service_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        price INTEGER NOT NULL CHECK(price >= 1 AND price <= 999999),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_price_placard_service_catalog_name ON service_catalog(name);
    `)
    candidate.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`)
  })()
}

function validateSchema(candidate, { allowVersionOne = false, expectedVersion = DATABASE_SCHEMA_VERSION } = {}) {
  const actualVersion = candidate.pragma('user_version', { simple: true })
  if (allowVersionOne && actualVersion === 1) {
    validateVersionOneSchema(candidate)
    return
  }
  if (actualVersion !== expectedVersion) throw new Error(`数据库版本必须为 ${expectedVersion}`)
  const includesServiceCatalog = expectedVersion >= 3
  const schemaObjects = candidate.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all()
  const tableNames = schemaObjects.filter((item) => item.type === 'table').map((item) => item.name).sort()
  const expectedColumns = includesServiceCatalog
    ? EXPECTED_COLUMNS
    : Object.fromEntries(Object.entries(EXPECTED_COLUMNS).filter(([name]) => name !== 'service_catalog'))
  const expectedTables = Object.keys(expectedColumns).sort()
  if (JSON.stringify(tableNames) !== JSON.stringify(expectedTables)) throw new Error('数据库表结构不兼容')
  if (schemaObjects.some((item) => item.type === 'view')) throw new Error('数据库不能包含视图')

  for (const [tableName, expected] of Object.entries(expectedColumns)) {
    const actual = candidate.prepare(`PRAGMA table_info(${tableName})`).all()
    if (actual.length !== expected.length) throw new Error(`${tableName} 表结构不兼容`)
    expected.forEach(([name, type, notnull, pk], index) => {
      const column = actual[index]
      if (column.name !== name || column.type.toUpperCase() !== type || column.notnull !== notnull || column.pk !== pk || column.dflt_value !== null) {
        throw new Error(`${tableName} 表结构不兼容`)
      }
    })
    const tableSql = schemaObjects.find((item) => item.type === 'table' && item.name === tableName)?.sql ?? ''
    const checks = [...tableSql.matchAll(/CHECK\s*\(([^()]*)\)/gi)]
      .map((match) => match[1].replace(/\s+/g, '').toLowerCase()).sort()
    const expectedChecks = {
      placards: [],
      placard_versions: ['version_number>0'],
      image_assets: ['byte_length>0andbyte_length<=1048576', 'height>0andheight<=1200', 'width>0andwidth<=1200'],
      version_assets: [],
      image_claim_sessions: [],
      image_asset_claims: [],
      service_catalog: ['price>=1andprice<=999999'],
    }[tableName]
    if (JSON.stringify(checks) !== JSON.stringify(expectedChecks)) throw new Error(`${tableName} CHECK 约束不兼容`)
  }

  const expectedForeignKeys = Object.freeze({
    placards: ['current_version_id:placard_versions:id:SET NULL'],
    placard_versions: ['placard_id:placards:id:CASCADE'],
    image_assets: [],
    version_assets: ['asset_id:image_assets:id:RESTRICT', 'version_id:placard_versions:id:CASCADE'],
    image_claim_sessions: [],
    image_asset_claims: ['asset_id:image_assets:id:CASCADE', 'token:image_claim_sessions:token:CASCADE'],
    ...(includesServiceCatalog ? { service_catalog: [] } : {}),
  })
  for (const [tableName, expected] of Object.entries(expectedForeignKeys)) {
    const actual = candidate.prepare(`PRAGMA foreign_key_list(${tableName})`).all()
      .map((row) => `${row.from}:${row.table}:${row.to}:${row.on_delete}`).sort()
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error(`${tableName} 外键结构不兼容`)
  }

  const expectedIndexes = Object.freeze({
    idx_price_placards_updated_at: ['updated_at', 'id'],
    idx_price_placard_versions_placard: ['placard_id', 'version_number'],
    idx_price_placard_version_assets_asset: ['asset_id'],
    idx_price_placard_claims_asset_expiry: ['asset_id', 'expires_at'],
    idx_price_placard_claims_expiry: ['expires_at'],
    ...(includesServiceCatalog ? { idx_price_placard_service_catalog_name: ['name'] } : {}),
  })
  const namedIndexes = schemaObjects.filter((item) => item.type === 'index').map((item) => item.name).sort()
  if (JSON.stringify(namedIndexes) !== JSON.stringify(Object.keys(expectedIndexes).sort())) throw new Error('数据库索引结构不兼容')
  for (const [indexName, expected] of Object.entries(expectedIndexes)) {
    const actual = candidate.prepare(`PRAGMA index_info(${indexName})`).all().map((row) => row.name)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${indexName} 索引结构不兼容`)
  }
  const hasUniqueIndex = (tableName, columns) => candidate.prepare(`PRAGMA index_list(${tableName})`).all().some((index) => {
    if (!index.unique) return false
    const actual = candidate.prepare(`PRAGMA index_info(${index.name})`).all().map((row) => row.name)
    return JSON.stringify(actual) === JSON.stringify(columns)
  })
  if (!hasUniqueIndex('placard_versions', ['placard_id', 'version_number'])
      || !hasUniqueIndex('image_assets', ['sha256'])
      || !hasUniqueIndex('version_assets', ['version_id', 'asset_id'])
      || !hasUniqueIndex('image_claim_sessions', ['token'])
      || !hasUniqueIndex('image_asset_claims', ['token', 'asset_id'])
      || (includesServiceCatalog && !hasUniqueIndex('service_catalog', ['name']))) {
    throw new Error('数据库唯一约束不兼容')
  }

  const triggers = schemaObjects.filter((item) => item.type === 'trigger')
  if (triggers.length !== 1 || triggers[0].name !== 'trg_price_placard_versions_immutable' ||
      !/BEFORE\s+UPDATE\s+ON\s+placard_versions/i.test(triggers[0].sql ?? '') ||
      !/RAISE\s*\(\s*ABORT\s*,\s*'placard versions are immutable'\s*\)/i.test(triggers[0].sql ?? '')) {
    throw new Error('数据库版本不可变约束不兼容')
  }
}

function validateDataset(candidate, { rejectOrphanImages = false, rejectClaims = false, allowVersionOne = false } = {}) {
  const integrity = candidate.pragma('integrity_check', { simple: true })
  if (integrity !== 'ok') throw new Error('数据库完整性检查失败')
  const schemaVersion = candidate.pragma('user_version', { simple: true })
  if (allowVersionOne && schemaVersion === 2) validateSchema(candidate, { expectedVersion: 2 })
  else validateSchema(candidate, { allowVersionOne })
  if (candidate.prepare('PRAGMA foreign_key_check').all().length) throw new Error('数据库外键完整性检查失败')
  if (schemaVersion >= 2) {
    const sessions = new Map()
    for (const row of candidate.prepare('SELECT token, expires_at FROM image_claim_sessions').iterate()) {
      if (typeof row.token !== 'string' || !UUID_PATTERN.test(row.token) || !isValidTimestamp(row.expires_at)) throw new Error('图片 claim session 无效')
      sessions.set(row.token, row.expires_at)
    }
    let claimCount = 0
    for (const row of candidate.prepare('SELECT token, asset_id, expires_at FROM image_asset_claims').iterate()) {
      claimCount += 1
      if (sessions.get(row.token) !== row.expires_at || !isPositiveSafeInteger(row.asset_id)) throw new Error('图片 claim 引用无效')
    }
    if (rejectClaims && (sessions.size || claimCount)) throw new Error('可移植数据库不能包含临时图片 claims')
  }

  const placardCount = candidate.prepare('SELECT COUNT(*) AS count FROM placards').get().count
  const imageCount = candidate.prepare('SELECT COUNT(*) AS count FROM image_assets').get().count
  const versionCount = candidate.prepare('SELECT COUNT(*) AS count FROM placard_versions').get().count
  const serviceCount = schemaVersion >= 3 ? candidate.prepare('SELECT COUNT(*) AS count FROM service_catalog').get().count : 0
  if (placardCount > MAX_PLACARDS) throw new Error(`当前展牌不能超过 ${MAX_PLACARDS} 张`)
  if (imageCount > MAX_IMAGE_ASSETS) throw new Error(`图片数量不能超过 ${MAX_IMAGE_ASSETS}`)
  if (serviceCount > MAX_SERVICE_CATALOG) throw new Error(`服务库不能超过 ${MAX_SERVICE_CATALOG} 项`)
  if (schemaVersion >= 3) {
    for (const row of candidate.prepare('SELECT * FROM service_catalog ORDER BY id').iterate()) {
      if (!isPositiveSafeInteger(row.id) || !isValidTimestamp(row.created_at) || !isValidTimestamp(row.updated_at)
          || Date.parse(row.created_at) > Date.parse(row.updated_at)) throw new Error(`服务 ${row.id} 元数据无效`)
      const validated = validateServiceCatalogItem({ name: row.name, price: row.price })
      if (validated.name !== row.name || validated.price !== row.price) throw new Error(`服务 ${row.id} 内容未规范化`)
    }
  }
  const totalImageBytes = candidate.prepare('SELECT COALESCE(SUM(byte_length), 0) AS total FROM image_assets').get().total
  if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('数据集内图片总大小不能超过 250MB')

  const imageIds = new Set()
  const referencedImageIds = new Set()
  for (const image of candidate.prepare('SELECT * FROM image_assets ORDER BY id').iterate()) {
    if (!isPositiveSafeInteger(image.id) || !isValidTimestamp(image.created_at)) throw new Error(`图片 ${image.id} 元数据无效`)
    const checked = inspectImageBuffer(image.data, image.mime_type)
    if (checked.width !== image.width || checked.height !== image.height || checked.byteLength !== image.byte_length || checked.sha256 !== image.sha256) throw new Error(`图片 ${image.id} 元数据与内容不一致`)
    imageIds.add(image.id)
  }

  const versionsByPlacard = new Map()
  const versions = new Map()
  for (const row of candidate.prepare('SELECT * FROM placard_versions ORDER BY placard_id, version_number').iterate()) {
    if (!isPositiveSafeInteger(row.id) || !isPositiveSafeInteger(row.placard_id) || !isPositiveSafeInteger(row.version_number) || !isValidTimestamp(row.created_at)) throw new Error(`版本 ${row.id} 元数据无效`)
    let content
    let sourceSnapshots
    try { content = JSON.parse(row.content_json); sourceSnapshots = JSON.parse(row.source_snapshots_json) } catch { throw new Error(`版本 ${row.id} JSON 无效`) }
    const validated = validatePlacardPayload({ content, sourceSnapshots })
    if (JSON.stringify(validated.content) !== row.content_json || JSON.stringify(validated.sourceSnapshots) !== row.source_snapshots_json) throw new Error(`版本 ${row.id} 内容未规范化`)
    const expectedAssets = collectAssetIds(validated.content)
    const actualAssets = candidate.prepare('SELECT asset_id FROM version_assets WHERE version_id = ? ORDER BY asset_id').all(row.id).map((item) => item.asset_id)
    if (JSON.stringify(expectedAssets) !== JSON.stringify(actualAssets) || actualAssets.some((assetId) => !imageIds.has(assetId))) throw new Error(`版本 ${row.id} 图片引用不完整`)
    actualAssets.forEach((assetId) => referencedImageIds.add(assetId))
    versions.set(row.id, row)
    const entries = versionsByPlacard.get(row.placard_id) || []
    entries.push(row)
    versionsByPlacard.set(row.placard_id, entries)
  }

  if (rejectOrphanImages && [...imageIds].some((imageId) => !referencedImageIds.has(imageId))) {
    throw new Error('导入数据不能包含未被任何展牌历史版本引用的孤儿图片')
  }

  for (const placard of candidate.prepare('SELECT * FROM placards ORDER BY id').iterate()) {
    if (!isPositiveSafeInteger(placard.id) || !isValidTimestamp(placard.created_at) || !isValidTimestamp(placard.updated_at) || Date.parse(placard.created_at) > Date.parse(placard.updated_at)) throw new Error(`展牌 ${placard.id} 元数据无效`)
    const entries = versionsByPlacard.get(placard.id) || []
    if (!entries.length || entries.length > MAX_VERSIONS_PER_PLACARD) throw new Error(`展牌 ${placard.id} 版本数量无效`)
    entries.forEach((entry, index) => {
      if (entry.version_number !== index + 1) throw new Error(`展牌 ${placard.id} 版本号不连续`)
      if (index > 0 && Date.parse(entry.created_at) < Date.parse(entries[index - 1].created_at)) throw new Error(`展牌 ${placard.id} 版本时间无效`)
    })
    if (placard.created_at !== entries[0].created_at) throw new Error(`展牌 ${placard.id} 创建时间无效`)
    const current = versions.get(placard.current_version_id)
    if (!current || current.placard_id !== placard.id || current.id !== entries.at(-1).id) throw new Error(`展牌 ${placard.id} 当前版本引用无效`)
    const currentContent = JSON.parse(current.content_json)
    if (placard.title !== currentContent.title || placard.updated_at !== current.created_at) throw new Error(`展牌 ${placard.id} 当前数据与版本不一致`)
  }
  if ([...versionsByPlacard.keys()].some((id) => !candidate.prepare('SELECT 1 FROM placards WHERE id = ?').get(id))) throw new Error('存在孤立版本')
  return { placards: placardCount, versions: versionCount, images: imageCount, services: serviceCount, imageBytes: totalImageBytes }
}

function validateDatabaseContainerSync(filePath) {
  const candidate = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    candidate.pragma('query_only = ON')
    candidate.pragma('trusted_schema = OFF')
    candidate.pragma('foreign_keys = ON')
    return validateDataset(candidate, { rejectOrphanImages: true, rejectClaims: true, allowVersionOne: true })
  } finally { candidate.close() }
}

async function validateOpenDatabaseImages(candidate) {
  for (const image of candidate.prepare('SELECT id, sha256, mime_type, width, height, byte_length, data FROM image_assets ORDER BY id').iterate()) {
    await validateDecodedImage(image.data, image.mime_type, {
      sha256: image.sha256,
      width: image.width,
      height: image.height,
      byteLength: image.byte_length,
    })
  }
}

export async function validateDatabaseFile(filePath) {
  const candidate = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    candidate.pragma('query_only = ON')
    candidate.pragma('trusted_schema = OFF')
    candidate.pragma('foreign_keys = ON')
    const summary = validateDataset(candidate, { rejectOrphanImages: true, rejectClaims: true, allowVersionOne: true })
    await validateOpenDatabaseImages(candidate)
    return summary
  } finally { candidate.close() }
}

export async function createDatabaseBackup(targetPath) {
  await getDatabase().backup(targetPath)
  const candidate = new Database(targetPath, { fileMustExist: true })
  let summary
  try {
    configureDatabase(candidate, { enableWal: false })
    validateSchema(candidate)
    validateDataset(candidate)
    candidate.transaction(() => {
      candidate.prepare('DELETE FROM image_claim_sessions').run()
      candidate.prepare('DELETE FROM image_assets WHERE id NOT IN (SELECT asset_id FROM version_assets)').run()
    })()
    summary = validateDataset(candidate, { rejectOrphanImages: true, rejectClaims: true })
    await validateOpenDatabaseImages(candidate)
    candidate.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    candidate.close()
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(`${targetPath}${suffix}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  fsyncPath(targetPath)
  fsyncParentDirectory(targetPath)
  return summary
}

async function prepareStagedDatabase(stagedPath) {
  const candidate = new Database(stagedPath, { fileMustExist: true })
  try {
    configureDatabase(candidate, { enableWal: false })
    migrateSchema(candidate)
    candidate.prepare('DELETE FROM image_claim_sessions').run()
    validateDataset(candidate, { rejectOrphanImages: true, rejectClaims: true })
    await validateOpenDatabaseImages(candidate)
    candidate.pragma('wal_checkpoint(TRUNCATE)')
  } finally { candidate.close() }
  for (const suffix of ['-wal', '-shm']) {
    try { await fs.promises.unlink(`${stagedPath}${suffix}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

export async function restoreDatabase(sourcePath) {
  if (restoreInProgress) throw new Error('已有数据库恢复正在进行')
  restoreInProgress = true
  try {
    const summary = await validateDatabaseFile(sourcePath)
    await installDatabaseFile({
      sourcePath,
      directory: databaseDirectory,
      databasePath: DATABASE_PATH,
      prepareStaged: prepareStagedDatabase,
      closeStrict: closeDatabaseStrict,
      validateInstalled: validateDatabaseFile,
      validateSync: validateDatabaseContainerSync,
      reopen: () => openDatabase({ skipRecovery: true }),
    })
    return summary
  } finally {
    restoreInProgress = false
  }
}

export function createJsonStagingDatabase(filePath) {
  const candidate = new Database(filePath)
  try {
    configureDatabase(candidate, { enableWal: false })
    createSchema(candidate)
    candidate.exec('CREATE TEMP TABLE import_placard_current (placard_id INTEGER PRIMARY KEY, current_version_id INTEGER NOT NULL)')
    return candidate
  } catch (error) {
    candidate.close()
    throw error
  }
}

export async function validateJsonStagingDatabase(candidate) {
  const summary = validateDataset(candidate, { rejectOrphanImages: true, rejectClaims: true })
  await validateOpenDatabaseImages(candidate)
  candidate.pragma('wal_checkpoint(TRUNCATE)')
  return summary
}

export function exportJsonPayload() {
  const db = getDatabase()
  const placards = db.prepare('SELECT id, title, current_version_id AS currentVersionId, created_at AS createdAt, updated_at AS updatedAt FROM placards ORDER BY id').all()
  const versions = db.prepare('SELECT * FROM placard_versions ORDER BY placard_id, version_number').all().map((row) => parseVersionRow(row))
  const images = db.prepare(`
    SELECT DISTINCT i.id, i.sha256, i.mime_type AS mimeType, i.width, i.height,
           i.byte_length AS byteLength, i.data, i.created_at AS createdAt
    FROM image_assets i
    JOIN version_assets va ON va.asset_id = i.id
    ORDER BY i.id
  `).all().map((image) => ({ ...image, data: image.data.toString('base64') }))
  const versionAssets = db.prepare('SELECT version_id AS versionId, asset_id AS assetId FROM version_assets ORDER BY version_id, asset_id').all()
  const serviceCatalog = listServiceCatalog()
  return { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), serviceCatalog, placards, versions, images, versionAssets }
}

function validateJsonPayloadStructure(payload) {
  if (!isRecord(payload)) throw new Error('备份文件必须是 JSON 对象')
  if (![1, SCHEMA_VERSION].includes(payload.schemaVersion)) throw new Error(`JSON schemaVersion 必须为 1 或 ${SCHEMA_VERSION}`)
  if (!isValidTimestamp(payload.exportedAt)) throw new Error('exportedAt 必须是有效时间')
  for (const key of ['placards', 'versions', 'images', 'versionAssets']) if (!Array.isArray(payload[key])) throw new Error(`${key} 必须是数组`)
  const serviceCatalogInput = payload.schemaVersion === 1 ? [] : payload.serviceCatalog
  if (!Array.isArray(serviceCatalogInput)) throw new Error('serviceCatalog 必须是数组')
  if (serviceCatalogInput.length > MAX_SERVICE_CATALOG) throw new Error('服务库记录数量超出限制')
  const serviceIds = new Set()
  const serviceNames = new Set()
  const serviceCatalog = serviceCatalogInput.map((service, index) => {
    if (!isRecord(service) || !isPositiveSafeInteger(service.id) || serviceIds.has(service.id)
        || !isValidTimestamp(service.createdAt) || !isValidTimestamp(service.updatedAt)
        || Date.parse(service.createdAt) > Date.parse(service.updatedAt)) throw new Error(`serviceCatalog[${index}] 无效`)
    const validated = validateServiceCatalogItem(service)
    if (serviceNames.has(validated.name)) throw new Error(`serviceCatalog[${index}].name 重复`)
    serviceIds.add(service.id)
    serviceNames.add(validated.name)
    return { id: service.id, ...validated, created_at: service.createdAt, updated_at: service.updatedAt }
  })
  if (payload.placards.length > MAX_PLACARDS || payload.images.length > MAX_IMAGE_ASSETS) throw new Error('备份记录数量超出限制')
  if (payload.versions.length > MAX_PLACARDS * MAX_VERSIONS_PER_PLACARD) throw new Error('备份版本数量超出限制')

  const imageIds = new Set()
  const imageHashes = new Set()
  let imageBytes = 0
  const images = payload.images.map((image, index) => {
    if (!isRecord(image) || !isPositiveSafeInteger(image.id) || imageIds.has(image.id) || !isValidTimestamp(image.createdAt)) throw new Error(`images[${index}] 无效`)
    if (typeof image.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) || image.data.length % 4 !== 0) throw new Error(`images[${index}].data 不是有效 base64`)
    const data = Buffer.from(image.data, 'base64')
    const inspected = inspectImageBuffer(data, image.mimeType)
    if (inspected.sha256 !== image.sha256 || inspected.width !== image.width || inspected.height !== image.height || inspected.byteLength !== image.byteLength) throw new Error(`images[${index}] 元数据与内容不一致`)
    if (imageHashes.has(image.sha256)) throw new Error(`images[${index}].sha256 重复`)
    imageIds.add(image.id)
    imageHashes.add(image.sha256)
    imageBytes += data.length
    return { id: image.id, sha256: image.sha256, mime_type: image.mimeType, width: image.width, height: image.height, byte_length: image.byteLength, data, created_at: image.createdAt }
  })
  if (imageBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('数据集内图片总大小不能超过 250MB')

  const placardIds = new Set()
  const placards = payload.placards.map((placard, index) => {
    if (!isRecord(placard) || !isPositiveSafeInteger(placard.id) || placardIds.has(placard.id) || !isPositiveSafeInteger(placard.currentVersionId) || typeof placard.title !== 'string' || !isValidTimestamp(placard.createdAt) || !isValidTimestamp(placard.updatedAt) || Date.parse(placard.createdAt) > Date.parse(placard.updatedAt)) throw new Error(`placards[${index}] 无效`)
    placardIds.add(placard.id)
    return placard
  })

  const versionIds = new Set()
  const versionsByPlacard = new Map()
  const versions = payload.versions.map((version, index) => {
    if (!isRecord(version) || !isPositiveSafeInteger(version.id) || versionIds.has(version.id) || !placardIds.has(version.placardId) || !isPositiveSafeInteger(version.versionNumber) || !isValidTimestamp(version.createdAt)) throw new Error(`versions[${index}] 无效`)
    const validated = validatePlacardPayload({ content: version.content, sourceSnapshots: version.sourceSnapshots })
    versionIds.add(version.id)
    const entries = versionsByPlacard.get(version.placardId) || []
    entries.push({ ...version, ...validated })
    versionsByPlacard.set(version.placardId, entries)
    return { id: version.id, placard_id: version.placardId, version_number: version.versionNumber, content_json: JSON.stringify(validated.content), source_snapshots_json: JSON.stringify(validated.sourceSnapshots), created_at: version.createdAt }
  })

  if (payload.versionAssets.length > payload.versions.length * MAX_ASSETS_PER_VERSION) throw new Error('versionAssets 数量超出限制')
  const links = new Map()
  payload.versionAssets.forEach((link, index) => {
    if (!isRecord(link) || !versionIds.has(link.versionId) || !imageIds.has(link.assetId)) throw new Error(`versionAssets[${index}] 无效`)
    const key = `${link.versionId}:${link.assetId}`
    if (links.has(key)) throw new Error(`versionAssets[${index}] 重复`)
    links.set(key, { version_id: link.versionId, asset_id: link.assetId })
  })
  const referencedImageIds = new Set([...links.values()].map((link) => link.asset_id))
  if ([...imageIds].some((imageId) => !referencedImageIds.has(imageId))) {
    throw new Error('导入数据不能包含未被任何展牌历史版本引用的孤儿图片')
  }

  placards.forEach((placard) => {
    const entries = (versionsByPlacard.get(placard.id) || []).sort((left, right) => left.versionNumber - right.versionNumber)
    if (!entries.length || entries.length > MAX_VERSIONS_PER_PLACARD) throw new Error(`展牌 ${placard.id} 版本数量无效`)
    entries.forEach((entry, index) => {
      if (entry.versionNumber !== index + 1) throw new Error(`展牌 ${placard.id} 版本号不连续`)
      if (index > 0 && Date.parse(entry.createdAt) < Date.parse(entries[index - 1].createdAt)) throw new Error(`展牌 ${placard.id} 版本时间无效`)
      const expected = collectAssetIds(entry.content)
      const actual = [...links.values()].filter((link) => link.version_id === entry.id).map((link) => link.asset_id).sort((a, b) => a - b)
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`版本 ${entry.id} 图片引用不完整`)
    })
    const current = entries.at(-1)
    if (placard.createdAt !== entries[0].createdAt || placard.currentVersionId !== current.id || placard.title !== current.content.title || placard.updatedAt !== current.createdAt) throw new Error(`展牌 ${placard.id} 当前版本无效`)
  })
  return {
    value: { serviceCatalog, placards, versions, images, versionAssets: [...links.values()] },
    summary: { services: serviceCatalog.length, placards: placards.length, versions: versions.length, images: images.length, imageBytes },
  }
}

export async function validateJsonPayload(payload) {
  const validated = validateJsonPayloadStructure(payload)
  for (const image of validated.value.images) {
    await validateDecodedImage(image.data, image.mime_type, {
      sha256: image.sha256,
      width: image.width,
      height: image.height,
      byteLength: image.byte_length,
    })
  }
  return validated
}

async function importJsonPayload(payload) {
  const { value, summary } = await validateJsonPayload(payload)
  const db = getDatabase()
  db.transaction(() => {
    db.prepare('UPDATE placards SET current_version_id = NULL').run()
    db.prepare('DELETE FROM placards').run()
    db.prepare('DELETE FROM image_assets').run()
    db.prepare('DELETE FROM service_catalog').run()
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('placards', 'placard_versions', 'image_assets', 'service_catalog')").run()
    const insertService = db.prepare('INSERT INTO service_catalog (id, name, price, created_at, updated_at) VALUES (@id, @name, @price, @created_at, @updated_at)')
    value.serviceCatalog.forEach((row) => insertService.run(row))
    const insertPlacard = db.prepare('INSERT INTO placards (id, title, current_version_id, created_at, updated_at) VALUES (@id, @title, NULL, @createdAt, @updatedAt)')
    value.placards.forEach((row) => insertPlacard.run(row))
    const insertImage = db.prepare('INSERT INTO image_assets (id, sha256, mime_type, width, height, byte_length, data, created_at) VALUES (@id, @sha256, @mime_type, @width, @height, @byte_length, @data, @created_at)')
    value.images.forEach((row) => insertImage.run(row))
    const insertVersion = db.prepare('INSERT INTO placard_versions (id, placard_id, version_number, content_json, source_snapshots_json, created_at) VALUES (@id, @placard_id, @version_number, @content_json, @source_snapshots_json, @created_at)')
    value.versions.forEach((row) => insertVersion.run(row))
    const insertLink = db.prepare('INSERT INTO version_assets (version_id, asset_id) VALUES (@version_id, @asset_id)')
    value.versionAssets.forEach((row) => insertLink.run(row))
    const setCurrent = db.prepare('UPDATE placards SET current_version_id = ? WHERE id = ?')
    value.placards.forEach((row) => setCurrent.run(row.currentVersionId, row.id))
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('导入数据未通过外键完整性检查')
    validateDataset(db, { rejectOrphanImages: true })
  })()
  return summary
}
