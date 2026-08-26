import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { inspectAndExtractBackupPackage, MAX_BACKUP_BYTES } from './backup-package.js'

const SESSION_TTL_MS = 30 * 60 * 1000

function apiSuccess(response, data, message = 'success') {
  response.json({ code: 0, data, msg: message })
}

function apiError(message, status = 400, code = 'SYSTEM_BACKUP_ERROR') {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function removeDirectory(directoryPath) {
  if (directoryPath && fs.existsSync(directoryPath)) fs.rmSync(directoryPath, { recursive: true, force: true })
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function matchesToken(value, expected) {
  const actualBuffer = Buffer.from(value || '')
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}

export function createSystemPersistenceRouter({ persistenceService, onModuleRestored, maintenanceToken = '' } = {}) {
  if (!persistenceService) throw new Error('系统备份路由缺少持久化服务')
  const router = Router()
  const workPrefix = 'lenovo-store-operations-'
  for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
    if (!entry.name.startsWith(workPrefix) || !entry.isDirectory()) continue
    const stalePath = path.join(os.tmpdir(), entry.name)
    const stats = fs.lstatSync(stalePath)
    if (stats.isSymbolicLink() || (typeof process.getuid === 'function' && stats.uid !== process.getuid())) continue
    if (Date.now() - stats.mtimeMs > SESSION_TTL_MS) removeDirectory(stalePath)
  }
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), workPrefix))
  fs.chmodSync(workRoot, 0o700)
  process.once('exit', () => removeDirectory(workRoot))
  const sessions = new Map()
  const upload = multer({
    storage: multer.diskStorage({
      destination: workRoot,
      filename: (_request, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
    }),
    limits: { fileSize: MAX_BACKUP_BYTES, files: 1, fields: 0 },
  })

  function destroySession(sessionId) {
    const session = sessions.get(sessionId)
    if (!session) return false
    sessions.delete(sessionId)
    removeDirectory(session.directory)
    return true
  }

  function cleanupExpiredSessions() {
    const now = Date.now()
    for (const [sessionId, session] of sessions) {
      if (session.expiresAt <= now) destroySession(sessionId)
    }
  }

  const cleanupTimer = setInterval(cleanupExpiredSessions, 60 * 1000)
  cleanupTimer.unref()

  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store')
    if (request.get('X-Lenovo-Store-Maintenance') !== '1') {
      return response.status(403).json({ code: 1, data: null, msg: '缺少系统维护请求标识' })
    }
    if (maintenanceToken) {
      const authorization = request.get('Authorization') || ''
      const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
      if (!matchesToken(suppliedToken, maintenanceToken)) {
        return response.status(401).json({ code: 1, data: null, msg: '系统维护令牌无效' })
      }
    } else if (!isLoopbackRequest(request)) {
      return response.status(403).json({ code: 1, data: null, msg: '未配置维护令牌时仅允许服务器本机操作' })
    }
    const origin = request.get('Origin')
    if (origin) {
      try {
        if (new URL(origin).origin !== `${request.protocol}://${request.get('host')}`) return response.status(403).json({ code: 1, data: null, msg: '仅允许同源执行系统维护操作' })
      } catch {
        return response.status(403).json({ code: 1, data: null, msg: '请求来源无效' })
      }
    }
    cleanupExpiredSessions()
    return next()
  })

  router.get('/backups/export', async (_request, response, next) => {
    const operationDirectory = fs.mkdtempSync(path.join(workRoot, 'export-'))
    const outputPath = path.join(operationDirectory, 'backup.lsbackup')
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      removeDirectory(operationDirectory)
    }
    try {
      const manifest = await persistenceService.createBackup(outputPath, operationDirectory)
      const timestamp = manifest.createdAt.replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
      response.set('Content-Type', 'application/vnd.lenovo-store.backup')
      response.set('Content-Disposition', `attachment; filename="lenovo-store-backup-${timestamp}.lsbackup"`)
      response.once('finish', cleanup)
      response.once('close', cleanup)
      return response.sendFile(outputPath, error => {
        if (error && !response.headersSent) next(error)
        cleanup()
      })
    } catch (error) {
      cleanup()
      return next(error)
    }
  })

  router.post('/restores/inspect', upload.single('file'), (request, response, next) => {
    if (!request.file) return next(apiError('请选择 .lsbackup 统一备份文件'))
    const sessionId = crypto.randomUUID()
    const sessionDirectory = path.join(workRoot, `session-${sessionId}`)
    try {
      const { manifest, extracted } = inspectAndExtractBackupPackage(request.file.path, sessionDirectory)
      const inspection = persistenceService.inspect(manifest, extracted)
      const expiresAt = Date.now() + SESSION_TTL_MS
      const session = { directory: sessionDirectory, manifest, extracted, inspection, expiresAt, moduleStatuses: new Map() }
      sessions.set(sessionId, session)
      return apiSuccess(response, {
        sessionId,
        expiresAt: new Date(expiresAt).toISOString(),
        ...inspection,
      }, '备份包检查通过，请逐个确认需要恢复的模块')
    } catch (error) {
      removeDirectory(sessionDirectory)
      return next(error)
    } finally {
      if (request.file && fs.existsSync(request.file.path)) fs.unlinkSync(request.file.path)
    }
  })

  router.post('/restores/:sessionId/modules/:moduleId', async (request, response, next) => {
    const session = sessions.get(request.params.sessionId)
    if (!session) return next(apiError('恢复会话不存在或已过期，请重新上传备份', 410, 'RESTORE_SESSION_EXPIRED'))
    if (session.expiresAt <= Date.now()) {
      destroySession(request.params.sessionId)
      return next(apiError('恢复会话已过期，请重新上传备份', 410, 'RESTORE_SESSION_EXPIRED'))
    }
    if (session.moduleStatuses.get(request.params.moduleId) === 'restoring') return next(apiError('此模块正在恢复', 409))
    session.moduleStatuses.set(request.params.moduleId, 'restoring')
    try {
      const result = await persistenceService.restore(request.params.moduleId, session.manifest, session.extracted)
      session.moduleStatuses.set(request.params.moduleId, 'succeeded')
      onModuleRestored?.(request.params.moduleId)
      return apiSuccess(response, { ...result, status: 'succeeded' }, `${result.name}恢复完成`)
    } catch (error) {
      session.moduleStatuses.set(request.params.moduleId, 'failed')
      return next(error)
    }
  })

  router.delete('/restores/:sessionId', (request, response, next) => {
    if (!destroySession(request.params.sessionId)) return next(apiError('恢复会话不存在或已过期', 410, 'RESTORE_SESSION_EXPIRED'))
    return apiSuccess(response, { deleted: true }, '恢复会话已清理')
  })

  router.use((error, _request, response, next) => {
    if (response.headersSent) return next(error)
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? '统一备份文件不能超过 1GB' : '上传的备份文件无效'
      return response.status(400).json({ code: 1, data: null, msg: message })
    }
    const status = Number.isInteger(error.status) ? error.status : 500
    if (status >= 500) console.error(`系统备份恢复错误 [${error.code || status}]：${error.message}`)
    return response.status(status).json({ code: 1, data: null, msg: error.message || '系统备份恢复失败' })
  })

  return router
}
