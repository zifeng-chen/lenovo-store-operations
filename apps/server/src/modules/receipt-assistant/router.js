import crypto from 'node:crypto'
import { Router, json } from 'express'
import { getDatabase, OCR_KEY_PATH } from './database.js'
import { createBaiduOcrService } from './baidu-ocr.js'
import { createOcrStorage, getOcrBillingMonth, isValidOcrBillingMonth } from './ocr-storage.js'

const OCR_DEADLINE_MS = 35000
const OCR_MAX_IMAGE_BYTES = 6 * 1024 * 1024
const OCR_EXPORT_MAX_ROWS = 10000
const OCR_EXPORT_MAX_SOURCE_BYTES = 10 * 1024 * 1024
const OCR_EXPORT_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

function toLocalISODate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createRequestError(status, message, code) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function requireSameOriginManagement(request, response, next) {
  const origin = request.get('Origin')
  if (origin) {
    try {
      if (new URL(origin).origin === `${request.protocol}://${request.get('host')}`) return next()
    } catch {}
    return response.status(403).json({ message: '仅允许从当前付款凭证页面管理 OCR 记录' })
  }
  if (request.get('Sec-Fetch-Site') === 'same-origin') return next()
  return response.status(403).json({ message: 'OCR 记录管理请求必须来自同源页面' })
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function historyCsv(items) {
  const columns = [
    ['id', 'id'],
    ['requestId', 'request_id'],
    ['status', 'status'],
    ['amount', 'amount'],
    ['matchedText', 'matched_text'],
    ['wordsCount', 'words_count'],
    ['errorCode', 'error_code'],
    ['httpStatus', 'http_status'],
    ['errorMessage', 'error_message'],
    ['durationMs', 'duration_ms'],
    ['createdAt', 'created_at_utc'],
    ['recognizedText', 'recognized_text'],
  ]
  return [
    columns.map(([, heading]) => csvCell(heading)).join(','),
    ...items.map(item => columns.map(([field]) => csvCell(item[field])).join(',')),
  ].join('\r\n')
}

function exportFileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function isSupportedOcrImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9
  return isPng || isJpeg
}

function createRuntime() {
  const db = getDatabase()
  const storage = createOcrStorage({ db, keyFilePath: OCR_KEY_PATH, environmentKey: process.env.OCR_CONFIG_ENCRYPTION_KEY })
  const environmentCredentials = process.env.BAIDU_OCR_API_KEY && process.env.BAIDU_OCR_SECRET_KEY
    ? { apiKey: process.env.BAIDU_OCR_API_KEY, secretKey: process.env.BAIDU_OCR_SECRET_KEY }
    : null
  let credentials = null
  let credentialSource = 'none'
  let credentialStorageError = false
  try {
    credentials = storage.loadCredentials()
    if (credentials) credentialSource = 'database'
  } catch (error) {
    credentialStorageError = true
    console.error(`付款凭证 OCR 凭据存储错误 [${error.code || 'UNKNOWN'}]，请在页面重新配置`)
  }
  if (!credentials && environmentCredentials) {
    credentials = environmentCredentials
    credentialSource = 'environment'
  }
  const createService = (nextCredentials = credentials) => createBaiduOcrService({
    apiKey: nextCredentials?.apiKey,
    secretKey: nextCredentials?.secretKey,
    endpoint: process.env.BAIDU_OCR_ENDPOINT,
  })
  return {
    db,
    storage,
    get credentials() { return credentials },
    set credentials(value) { credentials = value },
    get credentialSource() { return credentialSource },
    set credentialSource(value) { credentialSource = value },
    get credentialStorageError() { return credentialStorageError },
    set credentialStorageError(value) { credentialStorageError = value },
    createService,
    service: createService(),
  }
}

export function createReceiptAssistantRouter() {
  const router = Router()
  const ocrRequestHistory = new Map()
  let runtime
  let activeOcrRequests = 0
  let activeConfigWrites = 0
  let maintenanceMode = false
  const getRuntime = () => runtime || (runtime = createRuntime())

  router.use((request, response, next) => {
    if (maintenanceMode && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      return response.status(503).json({ message: '付款凭证数据正在维护，请稍后重试' })
    }
    return next()
  })

  router.use(json({ limit: '100kb', type: 'application/json' }))

  function getConfigStatus() {
    const state = getRuntime()
    return state.storage.getConfigStatus(state.credentials, state.credentialSource, state.credentialStorageError)
  }

  router.get('/ocr/config', (_request, response) => response.json(getConfigStatus()))

  router.put('/ocr/config', async (request, response, next) => {
    const state = getRuntime()
    const apiKeyInput = typeof request.body?.apiKey === 'string' ? request.body.apiKey.trim() : ''
    const secretKeyInput = typeof request.body?.secretKey === 'string' ? request.body.secretKey.trim() : ''
    const expectedVersion = Number(request.body?.version)
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return response.status(400).json({ message: 'OCR 配置版本无效，请刷新后重试' })
    if (expectedVersion !== getConfigStatus().version) return response.status(409).json({ message: 'OCR 配置已被其他操作更新，请刷新后重试' })
    if (!apiKeyInput && !secretKeyInput) return response.status(400).json({ message: '请至少填写 API Key 或 Secret Key' })
    const apiKey = apiKeyInput || state.credentials?.apiKey
    const secretKey = secretKeyInput || state.credentials?.secretKey
    if (!apiKey || !secretKey) return response.status(400).json({ message: '首次配置必须同时填写 API Key 和 Secret Key' })
    if (apiKey.length > 512 || secretKey.length > 512) return response.status(400).json({ message: 'API Key 或 Secret Key 长度无效' })

    const nextCredentials = { apiKey, secretKey }
    const nextService = state.createService(nextCredentials)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(createRequestError(504, '百度 OCR 凭据验证超时', 'OCR_CONFIG_VALIDATION_TIMEOUT')), 20000)
    activeConfigWrites += 1
    try {
      await nextService.validateCredentials({ signal: controller.signal })
      const saved = state.storage.saveCredentials({ ...nextCredentials, expectedVersion })
      state.credentials = { apiKey: saved.apiKey, secretKey: saved.secretKey }
      state.credentialSource = 'database'
      state.credentialStorageError = false
      state.service = nextService
      return response.json(getConfigStatus())
    } catch (error) {
      return next(error)
    } finally {
      activeConfigWrites = Math.max(0, activeConfigWrites - 1)
      clearTimeout(timeout)
    }
  })

  function ocrRateLimit(request, response, next) {
    const now = Date.now()
    const requestKey = request.ip || request.socket.remoteAddress || 'unknown'
    const recent = (ocrRequestHistory.get(requestKey) || []).filter(timestamp => timestamp > now - 60000)
    if (recent.length >= 10) return response.status(429).json({ message: '文字识别请求过于频繁，请稍后重试' })
    if (activeOcrRequests >= 2) return response.status(429).json({ message: '文字识别服务繁忙，请稍后重试' })
    recent.push(now)
    ocrRequestHistory.set(requestKey, recent)
    activeOcrRequests += 1

    const controller = new AbortController()
    let processing = false
    let released = false
    const abort = error => { if (!controller.signal.aborted) controller.abort(error) }
    const onAborted = () => abort(createRequestError(499, '客户端已取消文字识别请求', 'OCR_CLIENT_ABORTED'))
    const release = () => {
      if (released) return
      released = true
      clearTimeout(timeout)
      request.removeListener('aborted', onAborted)
      response.removeListener('close', onClose)
      response.removeListener('finish', onFinish)
      activeOcrRequests = Math.max(0, activeOcrRequests - 1)
    }
    const onClose = () => { if (!response.writableEnded) onAborted(); if (!processing) release() }
    const onFinish = () => { if (!processing) release() }
    const timeout = setTimeout(() => abort(createRequestError(504, '文字识别请求超过 35 秒', 'OCR_DEADLINE_EXCEEDED')), OCR_DEADLINE_MS)
    request.once('aborted', onAborted)
    response.once('close', onClose)
    response.once('finish', onFinish)
    response.locals.ocrRequest = { signal: controller.signal, startProcessing() { processing = true }, release }
    next()
  }

  function parseOcrImage(request, response, next) {
    if (!request.is(['image/png', 'image/jpeg'])) { request.body = undefined; return next() }
    const operation = response.locals.ocrRequest
    const chunks = []
    let size = 0
    let completed = false
    const cleanup = () => {
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      operation.signal.removeEventListener('abort', onAbort)
    }
    const complete = callback => { if (completed) return; completed = true; cleanup(); callback() }
    const stopReading = () => { cleanup(); request.resume() }
    const onData = chunk => {
      size += chunk.length
      if (size > OCR_MAX_IMAGE_BYTES) return complete(() => { stopReading(); next(createRequestError(413, '提交的图片过大，请压缩后重试', 'OCR_IMAGE_TOO_LARGE')) })
      chunks.push(chunk)
    }
    const onEnd = () => complete(() => { request.body = Buffer.concat(chunks); next() })
    const onError = error => complete(() => next(error))
    const onAbort = () => complete(() => {
      stopReading()
      const error = operation.signal.reason || createRequestError(499, '文字识别请求已取消', 'OCR_REQUEST_ABORTED')
      operation.release()
      if (error.status === 504 && !response.headersSent && !response.writableEnded) response.status(504).json({ message: error.message })
    })
    if (operation.signal.aborted) return onAbort()
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    operation.signal.addEventListener('abort', onAbort, { once: true })
  }

  router.post('/ocr/amount', ocrRateLimit, parseOcrImage, async (request, response, next) => {
    if (!isSupportedOcrImage(request.body)) return response.status(400).json({ message: '请提交有效的 PNG 或 JPEG 合成图片' })
    const state = getRuntime()
    const operation = response.locals.ocrRequest
    const requestId = crypto.randomUUID()
    const startedAt = Date.now()
    operation.startProcessing()
    const persistFailure = () => {
      console.error('付款凭证 OCR 历史记录写入失败 [DATABASE_ERROR]')
      return createRequestError(500, 'OCR 结果持久化失败，请稍后重试', 'OCR_HISTORY_PERSIST_FAILED')
    }
    try {
      let result
      try {
        result = await state.service.recognizeAmount(request.body, {
          signal: operation.signal,
          onAttempt: attemptNo => state.storage.recordUsageAttempt({ requestId, attemptNo }),
        })
      } catch (error) {
        try {
          error.historyId = state.storage.insertHistory({
            requestId,
            status: Number(error.status) === 499 ? 'cancelled' : 'failure',
            wordsCount: error.ocrDetails?.wordsCount,
            recognizedText: error.ocrDetails?.recognizedText,
            errorCode: error.code,
            httpStatus: Number(error.status) || 500,
            errorMessage: error.message,
            durationMs: Date.now() - startedAt,
          })
        } catch { return next(persistFailure()) }
        return next(error)
      }
      let historyId
      try {
        historyId = state.storage.insertHistory({ requestId, status: 'success', amount: result.amount, matchedText: result.matchedText, wordsCount: result.wordsCount, recognizedText: result.recognizedText, httpStatus: 200, durationMs: Date.now() - startedAt })
      } catch { return next(persistFailure()) }
      return response.json({ ...result, historyId })
    } finally {
      operation.release()
    }
  })

  router.get('/ocr/usage', (request, response) => {
    const month = request.query.month === undefined ? getOcrBillingMonth() : String(request.query.month)
    if (!isValidOcrBillingMonth(month)) return response.status(400).json({ message: '额度月份必须符合 YYYY-MM' })
    response.set('Cache-Control', 'no-store')
    return response.json(getRuntime().storage.getUsage(month))
  })

  router.get('/ocr/history/export', requireSameOriginManagement, (request, response) => {
    const format = String(request.query.format || 'csv').toLowerCase()
    if (!['csv', 'json'].includes(format)) return response.status(400).json({ message: '导出格式只支持 csv 或 json' })
    const storage = getRuntime().storage
    const stats = storage.getHistoryExportStats()
    if (stats.count > OCR_EXPORT_MAX_ROWS) return response.status(413).json({ message: `识别记录超过 ${OCR_EXPORT_MAX_ROWS} 条，请先删除不需要的记录后再导出` })
    if (stats.sourceBytes > OCR_EXPORT_MAX_SOURCE_BYTES) return response.status(413).json({ message: '识别记录全文超过 10MB，请先删除不需要的记录后再导出' })
    const items = storage.listHistoryForExport(OCR_EXPORT_MAX_ROWS)
    const exportedAt = new Date().toISOString()
    const filename = `receipt-ocr-history-${exportFileTimestamp(new Date(exportedAt))}.${format}`
    const body = format === 'json'
      ? `${JSON.stringify({ schemaVersion: 1, exportedAt, timezone: 'UTC', itemCount: items.length, items }, null, 2)}\n`
      : `\ufeff${historyCsv(items)}\r\n`
    if (Buffer.byteLength(body) > OCR_EXPORT_MAX_RESPONSE_BYTES) return response.status(413).json({ message: '识别记录导出文件超过 20MB，请先删除不需要的记录后再导出' })
    response.set('Cache-Control', 'no-store')
    response.set('Content-Disposition', `attachment; filename="${filename}"`)
    response.type(format === 'json' ? 'application/json' : 'text/csv; charset=utf-8')
    return response.send(body)
  })

  router.get('/ocr/history', (request, response) => {
    const page = request.query.page === undefined ? 1 : Number(request.query.page)
    const pageSize = request.query.pageSize === undefined ? 10 : Number(request.query.pageSize)
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) return response.status(400).json({ message: 'page 必须大于 0，pageSize 必须在 1 到 50 之间' })
    return response.json(getRuntime().storage.listHistory({ page, pageSize }))
  })

  router.get('/ocr/history/:id', (request, response) => {
    const id = Number(request.params.id)
    if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ message: '无效的 OCR 记录 ID' })
    const history = getRuntime().storage.getHistoryById(id)
    return history ? response.json(history) : response.status(404).json({ message: 'OCR 识别记录不存在' })
  })

  router.delete('/ocr/history/:id', requireSameOriginManagement, (request, response) => {
    const id = Number(request.params.id)
    if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ message: '无效的 OCR 记录 ID' })
    return getRuntime().storage.deleteHistory(id)
      ? response.status(204).end()
      : response.status(404).json({ message: 'OCR 识别记录不存在' })
  })

  const getSaleById = id => getRuntime().db.prepare('SELECT * FROM sales WHERE id = ?').get(id)

  router.post('/sales', (request, response) => {
    const amount = Number(request.body?.amount)
    if (!Number.isFinite(amount) || amount <= 0) return response.status(400).json({ message: '销售金额必须是大于 0 的数字' })
    const state = getRuntime()
    const result = state.db.prepare('INSERT INTO sales (sale_date, amount, status) VALUES (?, ?, 1)').run(toLocalISODate(), Math.round(amount * 100) / 100)
    return response.status(201).json(getSaleById(result.lastInsertRowid))
  })

  router.get('/sales', (request, response) => {
    const { status } = request.query
    const db = getRuntime().db
    if (status === undefined || status === '') return response.json(db.prepare('SELECT * FROM sales ORDER BY created_at DESC, id DESC').all())
    if (status === '0' || status === '1') return response.json(db.prepare('SELECT * FROM sales WHERE status = ? ORDER BY created_at DESC, id DESC').all(Number(status)))
    return response.status(400).json({ message: 'status 只能是 0 或 1' })
  })

  router.get('/sales/today', (_request, response) => {
    const row = getRuntime().db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM sales WHERE sale_date = ? AND status = 1').get(toLocalISODate())
    return response.json({ count: row.count, total: row.total })
  })

  router.get('/sales/trend', (_request, response) => {
    const endDate = new Date()
    endDate.setHours(0, 0, 0, 0)
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - 29)
    const rows = getRuntime().db.prepare(`
      SELECT sale_date AS date, COUNT(*) AS count, ROUND(SUM(amount), 2) AS total
      FROM sales
      WHERE status = 1 AND sale_date BETWEEN ? AND ?
      GROUP BY sale_date
      ORDER BY sale_date ASC
    `).all(toLocalISODate(startDate), toLocalISODate(endDate))
    const summaries = new Map(rows.map(row => [row.date, {
      count: Number(row.count) || 0,
      total: Number(row.total) || 0,
    }]))
    return response.json(Array.from({ length: 30 }, (_, index) => {
      const date = new Date(startDate)
      date.setDate(startDate.getDate() + index)
      const dateString = toLocalISODate(date)
      const summary = summaries.get(dateString)
      return { date: dateString, total: summary?.total || 0, count: summary?.count || 0 }
    }))
  })

  router.put('/sales/:id/toggle', (request, response) => {
    const id = Number(request.params.id)
    if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ message: '无效的销售记录 ID' })
    const sale = getSaleById(id)
    if (!sale) return response.status(404).json({ message: '销售记录不存在' })
    getRuntime().db.prepare('UPDATE sales SET status = ? WHERE id = ?').run(sale.status === 1 ? 0 : 1, id)
    return response.json(getSaleById(id))
  })

  router.use((error, _request, response, next) => {
    if (response.headersSent) return next(error)
    if (error?.type === 'entity.too.large') return response.status(413).json({ message: '请求数据过大' })
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) return response.status(400).json({ message: '请求体不是有效的 JSON' })
    const status = Number(error.status)
    if (!Number.isInteger(status) || status < 400 || status >= 600) return next(error)
    if (status >= 500) console.error(`付款凭证 OCR/API 错误 [${error.code || status}]：${error.message}`)
    const payload = { message: error.message }
    if (error.code) payload.code = error.code
    if (error.historyId) payload.historyId = error.historyId
    return response.status(status).json(payload)
  })

  Object.defineProperty(router, 'maintenanceCoordinator', {
    enumerable: false,
    value: {
      get activeOperations() { return activeOcrRequests + activeConfigWrites },
      async runRestore(task) {
        if (maintenanceMode) throw createRequestError(409, '付款凭证数据维护正在进行', 'RECEIPT_MAINTENANCE_ACTIVE')
        maintenanceMode = true
        try {
          if (activeOcrRequests || activeConfigWrites) {
            throw createRequestError(409, '存在进行中的 OCR 识别或配置保存，请稍后重试', 'RECEIPT_OPERATIONS_ACTIVE')
          }
          const result = await task()
          runtime = undefined
          return result
        } finally {
          maintenanceMode = false
        }
      },
    },
  })

  return router
}

const receiptAssistantRouter = createReceiptAssistantRouter()
export const receiptAssistantMaintenance = receiptAssistantRouter.maintenanceCoordinator
export default receiptAssistantRouter
