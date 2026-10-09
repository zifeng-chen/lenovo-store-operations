import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import {
  copyPlacardVersion,
  createDatabaseBackup,
  createImageClaim,
  createPlacard,
  createServiceCatalogItem,
  deletePlacard,
  deleteServiceCatalogItem,
  deleteUnusedImage,
  getImage,
  getPlacardDetail,
  getPlacardVersion,
  listPlacards,
  listPlacardVersions,
  listServiceCatalog,
  releaseImageClaim,
  restoreDatabase,
  restorePlacardVersion,
  storeImage,
  updatePlacard,
  updateServiceCatalogItem,
  upsertServiceCatalog,
  validateDatabaseFile,
} from './database.js'
import { MAX_SERVICE_CATALOG, decodeAndValidateImagePayload, validateServiceCatalogItem } from './validation.js'
import { processJsonImport, streamJsonExport } from './json-transfer.js'

const MAX_JSON_IMPORT_BYTES = 384 * 1024 * 1024
const MAX_DATABASE_IMPORT_BYTES = 1024 * 1024 * 1024
const MAX_SERVICE_EXCEL_BYTES = 5 * 1024 * 1024

function uploadError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function createUpload(extension, label, maxBytes) {
  return multer({
    storage: multer.diskStorage({
      destination: os.tmpdir(),
      filename: (_req, _file, callback) => callback(null, `price-placards-${randomUUID()}${extension}`),
    }),
    limits: { fileSize: maxBytes, files: 1, fields: 10 },
    fileFilter: (_req, file, callback) => {
      const valid = path.extname(file.originalname).toLowerCase() === extension
      callback(valid ? null : uploadError(`仅支持 ${extension} ${label}文件`), valid)
    },
  })
}

const jsonUpload = createUpload('.json', '备份', MAX_JSON_IMPORT_BYTES)
const databaseUpload = createUpload('.db', '数据库', MAX_DATABASE_IMPORT_BYTES)
const serviceExcelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SERVICE_EXCEL_BYTES, files: 1, fields: 5 },
  fileFilter: (_req, file, callback) => {
    const valid = path.extname(file.originalname).toLowerCase() === '.xlsx'
    callback(valid ? null : uploadError('仅支持 .xlsx 服务库文件'), valid)
  },
})

function parseServiceWorkbook(buffer) {
  let workbook
  try { workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true }) } catch { throw httpError(400, 'Excel 文件无法读取') }
  if (!workbook.SheetNames.length) throw httpError(400, 'Excel 文件没有工作表')
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (Object.entries(sheet).some(([address, cell]) => !address.startsWith('!') && cell?.f)) throw httpError(400, '服务库 Excel 不允许使用公式')
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
  const header = rows[0] || []
  if (header.length !== 2 || header[0] !== '服务名称' || header[1] !== '价格') {
    throw httpError(400, 'Excel 表头必须且只能是“服务名称”和“价格”')
  }
  const unique = new Map()
  rows.slice(1).forEach((row, index) => {
    if (row.every((value) => value === '' || value == null)) return
    if (row.length > 2 && row.slice(2).some((value) => value !== '' && value != null)) throw httpError(400, `Excel 第 ${index + 2} 行包含多余列`)
    const rawPrice = row[1]
    const price = typeof rawPrice === 'number'
      ? rawPrice
      : typeof rawPrice === 'string' && /^\d+$/.test(rawPrice.trim()) ? Number(rawPrice.trim()) : Number.NaN
    let validated
    try { validated = validateServiceCatalogItem({ name: row[0], price }) } catch (error) { throw httpError(400, `Excel 第 ${index + 2} 行：${error.message}`) }
    unique.set(validated.name, validated)
  })
  if (!unique.size) throw httpError(400, 'Excel 中至少需要一条服务数据')
  if (unique.size > MAX_SERVICE_CATALOG) throw httpError(400, `服务库不能超过 ${MAX_SERVICE_CATALOG} 项`)
  return [...unique.values()]
}

function markUploadType(type) {
  return (req, _res, next) => {
    req.pricePlacardsUploadType = type
    next()
  }
}

function timestamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function sendSuccess(res, data, msg = 'success', status = 200) {
  return res.status(status).json({ code: 0, data, msg })
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function parseId(value, label) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw httpError(400, `${label}无效`)
  const id = Number(value)
  if (!Number.isSafeInteger(id)) throw httpError(400, `${label}无效`)
  return id
}

function handle(handler) {
  return (req, res, next) => {
    try {
      Promise.resolve(handler(req, res, next)).catch(next)
    } catch (error) {
      next(error)
    }
  }
}

function domainCall(operation) {
  try {
    return operation()
  } catch (error) {
    if (!error.statusCode && !error.code) {
      error.statusCode = /最多|不能超过|总大小超出限制/.test(error.message) ? 409 : 400
    }
    throw error
  }
}

async function asyncDomainCall(operation) {
  try {
    return await operation()
  } catch (error) {
    if (!error.statusCode && !error.code) {
      error.statusCode = /最多|不能超过|总大小超出限制/.test(error.message) ? 409 : 400
    }
    throw error
  }
}

function requirePlacard(id) {
  const placard = getPlacardDetail(id)
  if (!placard) throw httpError(404, '展牌不存在')
  return placard
}

function requireVersion(placardId, versionId) {
  const version = getPlacardVersion(placardId, versionId)
  if (!version) throw httpError(404, '展牌版本不存在')
  return version
}

function isValidateOnly(req) {
  return req.query.validateOnly === 'true'
}

function hasImportConfirmation(req) {
  return (req.body?.confirm ?? req.query.confirm) === '导入'
}

async function removeUploadedFile(filePath) {
  if (!filePath) return
  try { await fs.promises.unlink(filePath) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

function etagMatches(header, etag) {
  if (typeof header !== 'string') return false
  return header.split(',').some((value) => {
    const candidate = value.trim()
    return candidate === '*' || candidate === etag || candidate === `W/${etag}`
  })
}

export function createPricePlacardsRouter({ authorizeMutation, authorizeImport } = {}) {
  if (typeof authorizeMutation !== 'function') throw new Error('价格展牌路由缺少同源写入授权中间件')
  if (typeof authorizeImport !== 'function') throw new Error('价格展牌导入路由缺少维护授权中间件')
  const router = Router()

  router.use((req, res, next) => {
    res.removeHeader('Access-Control-Allow-Origin')
    if (req.method === 'GET' || req.method === 'HEAD') return next()
    return authorizeMutation(req, res, next)
  })

  router.get('/services', handle((_req, res) => sendSuccess(res, listServiceCatalog())))

  router.post('/services', handle((req, res) => {
    const service = domainCall(() => createServiceCatalogItem(req.body))
    return sendSuccess(res, service, '服务创建成功', 201)
  }))

  router.put('/services/:id', handle((req, res) => {
    const id = parseId(req.params.id, '服务 ID')
    const service = domainCall(() => updateServiceCatalogItem(id, req.body))
    if (!service) throw httpError(404, '服务不存在')
    return sendSuccess(res, service, '服务更新成功')
  }))

  router.delete('/services/:id', handle((req, res) => {
    const id = parseId(req.params.id, '服务 ID')
    if (!deleteServiceCatalogItem(id)) throw httpError(404, '服务不存在')
    return sendSuccess(res, null, '服务删除成功')
  }))

  router.get('/services/export', handle((_req, res) => {
    const rows = listServiceCatalog().map((item) => [item.name, item.price])
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.aoa_to_sheet([['服务名称', '价格'], ...rows])
    worksheet['!cols'] = [{ wch: 36 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(workbook, worksheet, '想帮帮服务库')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="service_catalog_${timestamp()}.xlsx"`)
    res.setHeader('Content-Length', buffer.length)
    return res.send(buffer)
  }))

  router.post('/services/import', markUploadType('services-excel'), serviceExcelUpload.single('file'), handle((req, res) => {
    if (!req.file) throw httpError(400, '请选择 .xlsx 服务库文件')
    const items = parseServiceWorkbook(req.file.buffer)
    const result = domainCall(() => upsertServiceCatalog(items))
    return sendSuccess(res, result, `导入完成：新增 ${result.inserted} 项，更新 ${result.updated} 项`)
  }))

  router.get('/placards', handle((_req, res) => sendSuccess(res, listPlacards())))

  router.post('/placards', handle((req, res) => {
    const placard = domainCall(() => createPlacard(req.body, req.body?.claimToken))
    return sendSuccess(res, placard, '创建成功', 201)
  }))

  router.get('/placards/:id', handle((req, res) => {
    const id = parseId(req.params.id, '展牌 ID')
    return sendSuccess(res, requirePlacard(id))
  }))

  router.put('/placards/:id', handle((req, res) => {
    const id = parseId(req.params.id, '展牌 ID')
    const placard = domainCall(() => updatePlacard(id, req.body, req.body?.claimToken))
    if (!placard) throw httpError(404, '展牌不存在')
    return sendSuccess(res, placard, placard.changed ? '更新成功' : '内容未变化')
  }))

  router.delete('/placards/:id', handle((req, res) => {
    const id = parseId(req.params.id, '展牌 ID')
    if (!deletePlacard(id)) throw httpError(404, '展牌不存在')
    return sendSuccess(res, null, '删除成功')
  }))

  router.get('/placards/:id/versions', handle((req, res) => {
    const id = parseId(req.params.id, '展牌 ID')
    requirePlacard(id)
    return sendSuccess(res, listPlacardVersions(id))
  }))

  router.get('/placards/:id/versions/:versionId', handle((req, res) => {
    const id = parseId(req.params.id, '展牌 ID')
    const versionId = parseId(req.params.versionId, '版本 ID')
    return sendSuccess(res, requireVersion(id, versionId))
  }))

  router.post('/placards/:id/versions/:versionId/restore', handle((req, res) => {
    const id = parseId(req.params.id, '展牌 ID')
    const versionId = parseId(req.params.versionId, '版本 ID')
    requireVersion(id, versionId)
    const placard = domainCall(() => restorePlacardVersion(id, versionId))
    return sendSuccess(res, placard, '版本恢复成功')
  }))

  router.post('/placards/:id/versions/:versionId/copy', handle((req, res) => {
    const id = parseId(req.params.id, '展牌 ID')
    const versionId = parseId(req.params.versionId, '版本 ID')
    requireVersion(id, versionId)
    const placard = domainCall(() => copyPlacardVersion(id, versionId))
    return sendSuccess(res, placard, '复制成功', 201)
  }))

  router.post('/image-claims', handle((_req, res) => sendSuccess(res, createImageClaim(), '图片 claim 创建成功', 201)))

  router.delete('/image-claims/:token', handle((req, res) => {
    domainCall(() => releaseImageClaim(req.params.token))
    return sendSuccess(res, null, '图片 claim 已释放')
  }))

  router.delete('/image-claims/:token/images/:id', handle((req, res) => {
    const id = parseId(req.params.id, '图片 ID')
    domainCall(() => releaseImageClaim(req.params.token, id))
    return sendSuccess(res, null, '图片 claim 已释放')
  }))

  router.post('/images', handle(async (req, res) => {
    const image = await asyncDomainCall(() => decodeAndValidateImagePayload(req.body))
    const stored = domainCall(() => storeImage(image, req.body?.claimToken))
    return sendSuccess(res, stored, stored.deduplicated ? '图片已存在' : '图片上传成功', stored.deduplicated ? 200 : 201)
  }))

  router.get('/images/:id', handle((req, res) => {
    const id = parseId(req.params.id, '图片 ID')
    const image = getImage(id)
    if (!image) throw httpError(404, '图片不存在')
    const etag = `"${image.sha256}"`
    res.setHeader('Content-Type', image.mimeType)
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    if (etagMatches(req.get('If-None-Match'), etag)) return res.status(304).end()
    res.setHeader('Content-Length', image.byteLength)
    return res.send(image.data)
  }))

  router.delete('/images/:id', handle((req, res) => {
    const id = parseId(req.params.id, '图片 ID')
    if (!getImage(id)) throw httpError(404, '图片不存在')
    if (!deleteUnusedImage(id)) throw httpError(409, '图片仍被展牌版本使用，不能删除')
    return sendSuccess(res, null, '图片删除成功')
  }))

  router.get('/export/json', handle(async (_req, res) => {
    const filename = `price_placards_${timestamp()}.json`
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    await streamJsonExport(res)
  }))

  router.post('/import/json', authorizeImport, markUploadType('json'), jsonUpload.single('file'), handle(async (req, res) => {
    if (!req.file) throw httpError(400, '请选择 .json 备份文件')
    try {
      const validateOnly = isValidateOnly(req)
      if (!validateOnly && !hasImportConfirmation(req)) throw httpError(400, '全量导入必须提供 confirm=导入')
      const summary = await asyncDomainCall(() => processJsonImport(req.file.path, { install: !validateOnly }))
      return sendSuccess(res, summary, validateOnly ? '验证通过' : '导入成功')
    } finally {
      await removeUploadedFile(req.file.path)
    }
  }))

  router.get('/export/database', handle(async (_req, res, next) => {
    const filename = `price_placards_${timestamp()}.db`
    const tempPath = path.join(os.tmpdir(), `${randomUUID()}-${filename}`)
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    }
    try {
      await createDatabaseBackup(tempPath)
      res.once('finish', cleanup)
      res.once('close', cleanup)
      res.download(tempPath, filename, (error) => {
        cleanup()
        if (error && !res.headersSent) next(error)
      })
    } catch (error) {
      cleanup()
      throw error
    }
  }))

  router.post('/import/database', authorizeImport, markUploadType('database'), databaseUpload.single('file'), handle(async (req, res) => {
    if (!req.file) throw httpError(400, '请选择 .db 数据库文件')
    try {
      let summary
      try {
        summary = await validateDatabaseFile(req.file.path)
      } catch (error) {
        error.statusCode = 400
        throw error
      }
      if (isValidateOnly(req)) return sendSuccess(res, summary, '验证通过')
      if (!hasImportConfirmation(req)) throw httpError(400, '全量导入必须提供 confirm=导入')
      const imported = await restoreDatabase(req.file.path)
      return sendSuccess(res, imported, '数据库导入成功')
    } finally {
      await removeUploadedFile(req.file.path)
    }
  }))

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    if (error instanceof multer.MulterError) {
      const uploadType = req.pricePlacardsUploadType
      const isJsonImport = uploadType === 'json'
      const isServiceExcel = uploadType === 'services-excel'
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? isJsonImport
          ? 'JSON 备份文件的 HTTP 单文件上限为 384MB；数据集内图片总量上限为 250MB'
          : isServiceExcel ? '服务库 Excel 文件不能超过 5MB' : '数据库文件的 HTTP 单文件上限为 1GB'
        : '上传文件无效'
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: 1, data: null, msg: message })
    }
    if (error?.type === 'entity.too.large') return res.status(413).json({ code: 1, data: null, msg: '请求内容过大' })
    if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') return res.status(400).json({ code: 1, data: null, msg: 'JSON 请求内容无效' })
    if (error?.code?.startsWith?.('SQLITE_CONSTRAINT')) return res.status(409).json({ code: 1, data: null, msg: '数据冲突，操作无法完成' })
    if (error?.statusCode) return res.status(error.statusCode).json({ code: 1, data: null, msg: error.message })
    return next(error)
  })

  return router
}
