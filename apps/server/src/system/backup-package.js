import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MAGIC = Buffer.from('LSOBKP01')
const HEADER_SIZE = 12
const MAX_MANIFEST_BYTES = 256 * 1024
export const MAX_BACKUP_BYTES = 1024 * 1024 * 1024

const REQUIRED_DATABASE_ENTRIES = new Map([
  ['computer-labels.database', 'computer-labels'],
  ['price-labels.database', 'price-labels'],
  ['receipt-assistant.database', 'receipt-assistant'],
])
const OPTIONAL_ENTRY_IDS = new Set(['receipt-assistant.ocr-key'])
const EXTRACTED_NAMES = new Map([
  ['computer-labels.database', 'computer-labels.sqlite'],
  ['price-labels.database', 'price-labels.sqlite'],
  ['receipt-assistant.database', 'receipt-assistant.sqlite'],
  ['receipt-assistant.ocr-key', 'receipt-ocr.key'],
])

function packageError(message, code = 'INVALID_BACKUP_PACKAGE') {
  const error = new Error(message)
  error.code = code
  error.status = 400
  return error
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

function assertPayloadFile(filePath) {
  const stats = fs.lstatSync(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('备份源必须是普通文件')
  if (stats.size <= 0) throw new Error('备份源文件为空')
  return stats
}

function copyFileToDescriptor(sourcePath, targetDescriptor) {
  const sourceDescriptor = fs.openSync(sourcePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    while ((bytesRead = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, null)) > 0) {
      fs.writeSync(targetDescriptor, buffer, 0, bytesRead)
    }
  } finally {
    fs.closeSync(sourceDescriptor)
  }
}

export function writeBackupPackage({ outputPath, backupId, createdAt, payloads, ocrEncryption }) {
  let offset = 0
  const entries = payloads.map(payload => {
    const stats = assertPayloadFile(payload.path)
    const entry = {
      id: payload.id,
      moduleId: payload.moduleId,
      kind: payload.kind,
      offset,
      length: stats.size,
      sha256: hashFile(payload.path),
      counts: payload.counts || {},
    }
    offset += stats.size
    return entry
  })
  const manifest = {
    formatVersion: 1,
    application: 'lenovo-store-operations',
    backupId,
    createdAt,
    entries,
    ocrEncryption,
  }
  const manifestBuffer = Buffer.from(JSON.stringify(manifest), 'utf8')
  if (manifestBuffer.length > MAX_MANIFEST_BYTES) throw new Error('备份清单过大')
  const header = Buffer.alloc(HEADER_SIZE)
  MAGIC.copy(header)
  header.writeUInt32BE(manifestBuffer.length, MAGIC.length)
  const descriptor = fs.openSync(outputPath, 'wx', 0o600)
  try {
    fs.writeSync(descriptor, header)
    fs.writeSync(descriptor, manifestBuffer)
    for (const payload of payloads) copyFileToDescriptor(payload.path, descriptor)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  return manifest
}

function validateManifest(manifest, payloadLength) {
  if (!isPlainObject(manifest) || manifest.formatVersion !== 1 || manifest.application !== 'lenovo-store-operations') {
    throw packageError('不支持的统一备份格式或版本')
  }
  if (typeof manifest.backupId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manifest.backupId)) throw packageError('备份编号无效')
  if (typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) throw packageError('备份创建时间无效')
  if (!Array.isArray(manifest.entries)) throw packageError('备份清单缺少文件条目')
  if (!isPlainObject(manifest.ocrEncryption) || !['none', 'local', 'environment'].includes(manifest.ocrEncryption.mode)) {
    throw packageError('OCR 加密信息无效')
  }

  const seen = new Set()
  const requiredModules = new Set(REQUIRED_DATABASE_ENTRIES.values())
  const expectedOrder = [...REQUIRED_DATABASE_ENTRIES.keys(), ...(manifest.ocrEncryption.mode === 'local' ? ['receipt-assistant.ocr-key'] : [])]
  if (manifest.entries.length !== expectedOrder.length) throw packageError('备份条目数量无效')
  let expectedOffset = 0
  for (const [entryIndex, entry] of manifest.entries.entries()) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string') throw packageError('备份条目无效')
    if (entry.id !== expectedOrder[entryIndex]) throw packageError('备份条目顺序无效')
    if (seen.has(entry.id)) throw packageError(`备份包含重复条目：${entry.id}`)
    seen.add(entry.id)
    const expectedModule = REQUIRED_DATABASE_ENTRIES.get(entry.id)
    const isOptional = OPTIONAL_ENTRY_IDS.has(entry.id)
    if (!expectedModule && !isOptional) throw packageError(`备份包含未知条目：${entry.id}`)
    if (expectedModule) {
      if (entry.kind !== 'database' || entry.moduleId !== expectedModule) throw packageError(`数据库条目 ${entry.id} 的模块信息无效`)
      requiredModules.delete(expectedModule)
    } else if (entry.kind !== 'secret' || entry.moduleId !== 'receipt-assistant') {
      throw packageError('OCR 密钥条目信息无效')
    }
    if (!Number.isSafeInteger(entry.offset) || entry.offset !== expectedOffset) throw packageError('备份条目偏移不连续或发生重叠')
    if (!Number.isSafeInteger(entry.length) || entry.length <= 0) throw packageError('备份条目长度无效')
    if (!/^[0-9a-f]{64}$/i.test(entry.sha256 || '')) throw packageError('备份条目摘要无效')
    if (!isPlainObject(entry.counts)) throw packageError('备份条目统计信息无效')
    expectedOffset += entry.length
    if (expectedOffset > payloadLength) throw packageError('备份条目超出文件边界')
  }
  if (requiredModules.size) throw packageError(`备份缺少模块：${[...requiredModules].join('、')}`)
  if (expectedOffset !== payloadLength) throw packageError('备份文件包含未声明的尾随数据')
  const hasKey = seen.has('receipt-assistant.ocr-key')
  if ((manifest.ocrEncryption.mode === 'local') !== hasKey) throw packageError('OCR 本机密钥与清单声明不匹配')
  if (manifest.ocrEncryption.mode === 'environment' && !/^[0-9a-f]{64}$/i.test(manifest.ocrEncryption.fingerprint || '')) {
    throw packageError('OCR 环境密钥指纹无效')
  }
  return manifest
}

function copyRangeAndHash(sourceDescriptor, targetPath, position, length) {
  const targetDescriptor = fs.openSync(targetPath, 'wx', 0o600)
  const hash = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, length))
  let remaining = length
  let cursor = position
  try {
    while (remaining > 0) {
      const bytesRead = fs.readSync(sourceDescriptor, buffer, 0, Math.min(buffer.length, remaining), cursor)
      if (!bytesRead) throw packageError('备份条目被意外截断')
      const chunk = buffer.subarray(0, bytesRead)
      fs.writeSync(targetDescriptor, chunk)
      hash.update(chunk)
      remaining -= bytesRead
      cursor += bytesRead
    }
    fs.fsyncSync(targetDescriptor)
  } finally {
    fs.closeSync(targetDescriptor)
  }
  return hash.digest('hex')
}

export function inspectAndExtractBackupPackage(packagePath, sessionDirectory) {
  const stats = fs.lstatSync(packagePath)
  if (!stats.isFile() || stats.isSymbolicLink()) throw packageError('上传内容必须是普通文件')
  if (stats.size <= HEADER_SIZE || stats.size > MAX_BACKUP_BYTES) throw packageError('统一备份文件大小无效')
  const descriptor = fs.openSync(packagePath, 'r')
  try {
    const header = Buffer.alloc(HEADER_SIZE)
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw packageError('文件不是有效的 .lsbackup 统一备份包')
    }
    const manifestLength = header.readUInt32BE(MAGIC.length)
    if (manifestLength <= 0 || manifestLength > MAX_MANIFEST_BYTES || HEADER_SIZE + manifestLength >= stats.size) {
      throw packageError('备份清单长度无效')
    }
    const manifestBuffer = Buffer.alloc(manifestLength)
    if (fs.readSync(descriptor, manifestBuffer, 0, manifestLength, HEADER_SIZE) !== manifestLength) throw packageError('备份清单被截断')
    let manifest
    try { manifest = JSON.parse(manifestBuffer.toString('utf8')) }
    catch { throw packageError('备份清单不是有效 JSON') }
    validateManifest(manifest, stats.size - HEADER_SIZE - manifestLength)

    fs.mkdirSync(sessionDirectory, { recursive: false, mode: 0o700 })
    const extracted = new Map()
    const payloadStart = HEADER_SIZE + manifestLength
    for (const entry of manifest.entries) {
      const targetPath = path.join(sessionDirectory, EXTRACTED_NAMES.get(entry.id))
      const digest = copyRangeAndHash(descriptor, targetPath, payloadStart + entry.offset, entry.length)
      if (digest !== entry.sha256.toLowerCase()) throw packageError(`备份条目校验失败：${entry.id}`)
      extracted.set(entry.id, targetPath)
    }
    return { manifest, extracted }
  } catch (error) {
    if (fs.existsSync(sessionDirectory)) fs.rmSync(sessionDirectory, { recursive: true, force: true })
    throw error
  } finally {
    fs.closeSync(descriptor)
  }
}
