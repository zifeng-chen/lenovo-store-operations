import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import parser from 'stream-json'
import Assembler from 'stream-json/assembler.js'
import {
  DATABASE_PATH,
  createJsonStagingDatabase,
  getDatabase,
  restoreDatabase,
  validateJsonStagingDatabase,
} from './database.js'
import {
  MAX_ASSETS_PER_VERSION,
  MAX_IMAGE_ASSETS,
  MAX_IMAGE_BYTES,
  MAX_PLACARDS,
  MAX_SERVICE_CATALOG,
  MAX_TOTAL_IMAGE_BYTES,
  MAX_VERSIONS_PER_PLACARD,
  SCHEMA_VERSION,
  isPositiveSafeInteger,
  isRecord,
  isValidTimestamp,
  validateDecodedImage,
  validatePlacardPayload,
  validateServiceCatalogItem,
} from './validation.js'

const ROOT_KEYS_V1 = ['schemaVersion', 'exportedAt', 'placards', 'versions', 'images', 'versionAssets']
const ROOT_KEYS_V2 = ['schemaVersion', 'exportedAt', 'serviceCatalog', 'placards', 'versions', 'images', 'versionAssets']
const ARRAY_KEYS = new Set([...ROOT_KEYS_V1.slice(2), ...ROOT_KEYS_V2.slice(2)])
const MAX_RECORD_BYTES = {
  serviceCatalog: 8 * 1024,
  placards: 8 * 1024,
  versions: 160 * 1024,
  images: Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4096,
  versionAssets: 1024,
}

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function insertRecord(statements, section, value, index, counters) {
  if (!isRecord(value)) throw invalid(`${section}[${index}] 必须是对象`)
  if (section === 'serviceCatalog') {
    if (index >= MAX_SERVICE_CATALOG || !isPositiveSafeInteger(value.id) || !isValidTimestamp(value.createdAt)
        || !isValidTimestamp(value.updatedAt) || Date.parse(value.createdAt) > Date.parse(value.updatedAt)) {
      throw invalid(`serviceCatalog[${index}] 无效`)
    }
    const validated = validateServiceCatalogItem(value)
    statements.insertService.run(value.id, validated.name, validated.price, value.createdAt, value.updatedAt)
    return
  }
  if (section === 'placards') {
    if (index >= MAX_PLACARDS || !isPositiveSafeInteger(value.id) || !isPositiveSafeInteger(value.currentVersionId)
        || typeof value.title !== 'string' || !isValidTimestamp(value.createdAt) || !isValidTimestamp(value.updatedAt)
        || Date.parse(value.createdAt) > Date.parse(value.updatedAt)) throw invalid(`placards[${index}] 无效`)
    statements.insertPlacard.run(value.id, value.title, value.createdAt, value.updatedAt)
    statements.insertCurrent.run(value.id, value.currentVersionId)
    return
  }
  if (section === 'versions') {
    if (index >= MAX_PLACARDS * MAX_VERSIONS_PER_PLACARD || !isPositiveSafeInteger(value.id)
        || !isPositiveSafeInteger(value.placardId) || !isPositiveSafeInteger(value.versionNumber)
        || !isValidTimestamp(value.createdAt)) throw invalid(`versions[${index}] 无效`)
    const validated = validatePlacardPayload({ content: value.content, sourceSnapshots: value.sourceSnapshots })
    statements.insertVersion.run(value.id, value.placardId, value.versionNumber, JSON.stringify(validated.content), JSON.stringify(validated.sourceSnapshots), value.createdAt)
    return
  }
  if (section === 'versionAssets') {
    if (index >= counters.versions * MAX_ASSETS_PER_VERSION || !isPositiveSafeInteger(value.versionId) || !isPositiveSafeInteger(value.assetId)) throw invalid(`versionAssets[${index}] 无效`)
    statements.insertLink.run(value.versionId, value.assetId)
  }
}

async function insertImage(statements, value, index, counters) {
  if (!isRecord(value) || index >= MAX_IMAGE_ASSETS || !isPositiveSafeInteger(value.id) || !isValidTimestamp(value.createdAt)) throw invalid(`images[${index}] 无效`)
  if (typeof value.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data) || value.data.length % 4 !== 0) throw invalid(`images[${index}].data 不是有效 base64`)
  const data = Buffer.from(value.data, 'base64')
  if (data.toString('base64') !== value.data) throw invalid(`images[${index}].data 不是规范 base64`)
  if (data.length > MAX_IMAGE_BYTES) throw invalid(`images[${index}] 超过 1MB`)
  const checked = await validateDecodedImage(data, value.mimeType, {
    sha256: value.sha256,
    width: value.width,
    height: value.height,
    byteLength: value.byteLength,
  })
  counters.imageBytes += checked.byteLength
  if (counters.imageBytes > MAX_TOTAL_IMAGE_BYTES) throw invalid('数据集内图片总大小不能超过 250MB')
  statements.insertImage.run(value.id, value.sha256, value.mimeType, value.width, value.height, value.byteLength, data, value.createdAt)
}

function statementsFor(db) {
  return {
    insertService: db.prepare('INSERT INTO service_catalog (id, name, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
    insertPlacard: db.prepare('INSERT INTO placards (id, title, current_version_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)'),
    insertCurrent: db.prepare('INSERT INTO import_placard_current (placard_id, current_version_id) VALUES (?, ?)'),
    insertVersion: db.prepare('INSERT INTO placard_versions (id, placard_id, version_number, content_json, source_snapshots_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    insertImage: db.prepare('INSERT INTO image_assets (id, sha256, mime_type, width, height, byte_length, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    insertLink: db.prepare('INSERT INTO version_assets (version_id, asset_id) VALUES (?, ?)'),
  }
}

function tokenSize(token) {
  if (token.name === 'stringChunk' || token.name === 'numberChunk') return Buffer.byteLength(token.value)
  if (token.name === 'trueValue') return 4
  if (token.name === 'falseValue') return 5
  if (token.name === 'nullValue') return 4
  if (['startObject', 'endObject', 'startArray', 'endArray', 'startKey', 'endKey', 'startString', 'endString'].includes(token.name)) return 1
  return 0
}

async function parseIntoStaging(inputPath, stagingPath) {
  const db = createJsonStagingDatabase(stagingPath)
  const counters = { serviceCatalog: 0, placards: 0, versions: 0, images: 0, versionAssets: 0, imageBytes: 0 }
  let source
  try {
    const statements = statementsFor(db)
    db.exec('BEGIN IMMEDIATE')
    const seenRootKeys = []
    let schemaVersion = null
    let depth = 0
    let rootKey = null
    let section = null
    let recordAssembler = null
    let recordDepth = 0
    let recordBytes = 0
    let textKind = null
    let textChunks = []
    let textBytes = 0
    let rootEnded = false

    source = fs.createReadStream(inputPath)
    const tokens = source.pipe(parser({ packStrings: false, streamStrings: true, packKeys: false, streamKeys: true }))
    source.once('error', error => tokens.destroy(error))

    for await (const token of tokens) {
      if (recordAssembler) {
        recordBytes += tokenSize(token)
        if (recordBytes > MAX_RECORD_BYTES[section]) throw invalid(`${section}[${counters[section]}] 记录过大`)
      }

      if (token.name === 'startKey' || token.name === 'startString') {
        textKind = token.name === 'startKey' ? 'key' : 'string'
        textChunks = []
        textBytes = 0
        continue
      }
      if (token.name === 'stringChunk') {
        if (!textKind) continue
        textBytes += Buffer.byteLength(token.value)
        if (textBytes > (textKind === 'key' ? 100 : section ? MAX_RECORD_BYTES[section] : 100)) throw invalid('JSON 字符串或字段名超出允许长度')
        textChunks.push(token.value)
        continue
      }
      if (token.name === 'endKey') {
        const key = textChunks.join('')
        textKind = null
        if (depth === 1 && !recordAssembler) {
          rootKey = key
          seenRootKeys.push(key)
          const expectedKeys = schemaVersion === 1 ? ROOT_KEYS_V1 : ROOT_KEYS_V2
          const expected = expectedKeys[seenRootKeys.length - 1]
          if (key !== expected) throw invalid(`JSON 顶层字段必须按 ${expectedKeys.join(', ')} 排列且不能重复`)
        } else if (recordAssembler) recordAssembler.consume({ name: 'keyValue', value: key })
        continue
      }
      if (token.name === 'endString') {
        const value = textChunks.join('')
        textKind = null
        if (recordAssembler) recordAssembler.consume({ name: 'stringValue', value })
        else if (depth === 1 && rootKey === 'exportedAt') {
          if (!isValidTimestamp(value)) throw invalid('exportedAt 必须是有效时间')
        } else throw invalid('JSON 顶层结构无效')
        continue
      }

      if (token.name === 'startObject') {
        if (depth === 0) {
          depth = 1
          continue
        }
        if (section && depth === 2 && !recordAssembler) {
          recordAssembler = new Assembler()
          recordDepth = depth + 1
          recordBytes = tokenSize(token)
          recordAssembler.consume(token)
        } else if (recordAssembler) recordAssembler.consume(token)
        else throw invalid('JSON 只能包含固定顶层对象和记录对象')
        depth += 1
        continue
      }
      if (token.name === 'endObject') {
        if (recordAssembler) recordAssembler.consume(token)
        depth -= 1
        if (recordAssembler && depth < recordDepth) {
          const value = recordAssembler.current
          const index = counters[section]
          if (section === 'images') await insertImage(statements, value, index, counters)
          else insertRecord(statements, section, value, index, counters)
          counters[section] += 1
          recordAssembler = null
        } else if (depth === 0) rootEnded = true
        if (depth < 0) throw invalid('JSON 对象层级无效')
        continue
      }
      if (token.name === 'startArray') {
        if (recordAssembler) {
          recordAssembler.consume(token)
          depth += 1
          continue
        }
        if (depth !== 1 || !ARRAY_KEYS.has(rootKey) || section) throw invalid('JSON 数组位置无效')
        section = rootKey
        depth += 1
        continue
      }
      if (token.name === 'endArray') {
        if (recordAssembler) {
          recordAssembler.consume(token)
          depth -= 1
          continue
        }
        if (depth !== 2 || !section) throw invalid('JSON 数组结构无效')
        depth -= 1
        section = null
        continue
      }
      if (recordAssembler) {
        recordAssembler.consume(token)
        continue
      }
      if (token.name === 'numberValue' && depth === 1 && rootKey === 'schemaVersion') {
        schemaVersion = Number(token.value)
        if (![1, SCHEMA_VERSION].includes(schemaVersion)) throw invalid(`JSON schemaVersion 必须为 1 或 ${SCHEMA_VERSION}`)
        continue
      }
      if (!['startNumber', 'numberChunk', 'endNumber'].includes(token.name)) throw invalid('JSON 顶层值无效')
    }
    const expectedRootKeys = schemaVersion === 1 ? ROOT_KEYS_V1 : ROOT_KEYS_V2
    if (!rootEnded || depth !== 0 || seenRootKeys.length !== expectedRootKeys.length || section || recordAssembler || textKind) throw invalid('JSON 备份文件不完整')
    db.prepare(`UPDATE placards SET current_version_id = (
      SELECT current_version_id FROM import_placard_current WHERE placard_id = placards.id
    )`).run()
    db.exec('COMMIT')
    const summary = await validateJsonStagingDatabase(db)
    return { summary, counters }
  } catch (error) {
    source?.destroy()
    if (!error.statusCode && error.code?.startsWith?.('SQLITE_CONSTRAINT')) error.statusCode = 400
    throw error
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK')
    db.close()
  }
}

export async function processJsonImport(inputPath, { install = false } = {}) {
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'price-placards-import-'))
  const stagingPath = path.join(tempDirectory, 'staging.sqlite')
  try {
    const { summary } = await parseIntoStaging(inputPath, stagingPath)
    if (install) await restoreDatabase(stagingPath)
    return summary
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true })
  }
}

async function writeChunk(res, chunk) {
  if (res.destroyed || res.writableEnded) throw new Error('客户端已断开 JSON 导出连接')
  if (res.write(chunk)) return
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain)
      res.off('close', onClose)
      res.off('error', onError)
    }
    const onDrain = () => { cleanup(); resolve() }
    const onClose = () => { cleanup(); reject(new Error('客户端已断开 JSON 导出连接')) }
    const onError = error => { cleanup(); reject(error) }
    res.once('drain', onDrain)
    res.once('close', onClose)
    res.once('error', onError)
  })
}

async function writeArray(res, rows, serialize) {
  let first = true
  for (const row of rows) {
    await writeChunk(res, `${first ? '' : ','}${JSON.stringify(serialize(row))}`)
    first = false
  }
}

function openExportSnapshot() {
  // Enforce the module restore guard before opening the independent read snapshot.
  getDatabase()
  const db = new Database(DATABASE_PATH, { readonly: true, fileMustExist: true })
  try {
    db.pragma('query_only = ON')
    db.pragma('trusted_schema = OFF')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    db.exec('BEGIN')
    db.prepare('SELECT 1 FROM placards LIMIT 1').get()
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export async function streamJsonExport(res) {
  const db = openExportSnapshot()
  try {
    await writeChunk(res, `{"schemaVersion":${SCHEMA_VERSION},"exportedAt":${JSON.stringify(new Date().toISOString())},"serviceCatalog":[`)
    await writeArray(res, db.prepare('SELECT id, name, price, created_at AS createdAt, updated_at AS updatedAt FROM service_catalog ORDER BY id').iterate(), row => row)
    await writeChunk(res, '],"placards":[')
    await writeArray(res, db.prepare('SELECT id, title, current_version_id AS currentVersionId, created_at AS createdAt, updated_at AS updatedAt FROM placards ORDER BY id').iterate(), row => row)
    await writeChunk(res, '],"versions":[')
    await writeArray(res, db.prepare('SELECT * FROM placard_versions ORDER BY placard_id, version_number').iterate(), row => ({
      id: row.id,
      placardId: row.placard_id,
      versionNumber: row.version_number,
      content: JSON.parse(row.content_json),
      sourceSnapshots: JSON.parse(row.source_snapshots_json),
      createdAt: row.created_at,
    }))
    await writeChunk(res, '],"images":[')
    await writeArray(res, db.prepare(`SELECT i.id, i.sha256, i.mime_type AS mimeType, i.width, i.height,
      i.byte_length AS byteLength, i.data, i.created_at AS createdAt
      FROM image_assets i
      WHERE EXISTS (SELECT 1 FROM version_assets va WHERE va.asset_id = i.id)
      ORDER BY i.id`).iterate(), image => ({ ...image, data: image.data.toString('base64') }))
    await writeChunk(res, '],"versionAssets":[')
    await writeArray(res, db.prepare('SELECT version_id AS versionId, asset_id AS assetId FROM version_assets ORDER BY version_id, asset_id').iterate(), row => row)
    await writeChunk(res, ']}')
    db.exec('COMMIT')
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK')
    db.close()
  }
  res.end()
}
