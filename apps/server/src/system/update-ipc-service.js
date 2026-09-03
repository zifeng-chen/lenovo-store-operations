import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_IPC_BYTES = 64 * 1024
const ACTIVE_STATUSES = new Set(['queued', 'running'])
const ALLOWED_PHASES = new Set([
  'queued',
  'claimed',
  'backing-up',
  'downloading',
  'verifying',
  'installing',
  'switching',
  'restarting',
  'health-check',
  'finalizing',
  'rolling-back',
  'completed',
  'rolled-back',
  'failed-before-switch',
  'rollback-failed',
])

function ipcError(message, status = 500, code = 'UPDATE_IPC_ERROR') {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

function safeIdentity(value) {
  if (!isPlainObject(value)) return null
  const version = typeof value.version === 'string' ? value.version.slice(0, 32) : null
  const tag = typeof value.tag === 'string' && TAG_PATTERN.test(value.tag) ? value.tag : null
  const commit = typeof value.commit === 'string' && /^[0-9a-f]{40}$/i.test(value.commit) ? value.commit.toLowerCase() : null
  if (!version || !tag || !commit || version !== tag.slice(1)) return null
  return { version, tag, commit, shortCommit: commit.slice(0, 8) }
}

function readSafeJson(filePath, { requireRootOwner = false } = {}) {
  const stats = fs.lstatSync(filePath)
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > MAX_IPC_BYTES) {
    throw ipcError('更新任务状态文件不安全或已损坏', 503, 'UPDATE_STATE_INVALID')
  }
  if (requireRootOwner && (stats.uid !== 0 || (stats.mode & 0o022) !== 0)) {
    throw ipcError('更新任务状态文件权限不安全', 503, 'UPDATE_STATE_PERMISSIONS')
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!isPlainObject(value)) throw new Error('not object')
    return value
  } catch {
    throw ipcError('更新任务状态文件格式无效', 503, 'UPDATE_STATE_INVALID')
  }
}

function sanitizeState(raw) {
  const status = ['queued', 'running', 'succeeded', 'failed', 'rollback-failed'].includes(raw.status) ? raw.status : null
  const phase = ALLOWED_PHASES.has(raw.phase) ? raw.phase : null
  const jobId = UUID_PATTERN.test(raw.jobId) ? raw.jobId : null
  const targetTag = TAG_PATTERN.test(raw.targetTag) ? raw.targetTag : null
  if (raw.schemaVersion !== 1 || !status || !phase || !jobId || !targetTag) {
    throw ipcError('更新任务状态字段无效', 503, 'UPDATE_STATE_INVALID')
  }
  const error = isPlainObject(raw.error) && typeof raw.error.message === 'string'
    ? {
        code: typeof raw.error.code === 'string' ? raw.error.code.slice(0, 80) : 'UPDATE_FAILED',
        message: raw.error.message.slice(0, 500),
      }
    : null
  return {
    jobId,
    action: 'install',
    targetTag,
    status,
    phase,
    requestedAt: safeIsoDate(raw.requestedAt),
    startedAt: safeIsoDate(raw.startedAt),
    updatedAt: safeIsoDate(raw.updatedAt),
    finishedAt: safeIsoDate(raw.finishedAt),
    current: safeIdentity(raw.current),
    target: safeIdentity(raw.target),
    rolledBack: raw.rolledBack === true,
    error,
  }
}

function queuedState(raw) {
  if (raw.schemaVersion !== 1 || raw.action !== 'install' || !UUID_PATTERN.test(raw.jobId) || !TAG_PATTERN.test(raw.tag) || !safeIsoDate(raw.requestedAt)) {
    throw ipcError('待处理更新请求格式无效', 503, 'UPDATE_REQUEST_INVALID')
  }
  return {
    jobId: raw.jobId,
    action: 'install',
    targetTag: raw.tag,
    status: 'queued',
    phase: 'queued',
    requestedAt: raw.requestedAt,
    startedAt: null,
    updatedAt: raw.requestedAt,
    finishedAt: null,
    current: null,
    target: null,
    rolledBack: false,
    error: null,
  }
}

function validateParentDirectory(filePath) {
  const directory = path.dirname(filePath)
  try {
    const stats = fs.lstatSync(directory)
    if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync(directory) !== directory) throw new Error('unsafe')
  } catch {
    throw ipcError('更新任务目录不存在或不安全', 503, 'UPDATE_QUEUE_UNAVAILABLE')
  }
  return directory
}

function writeRequestAtomic(requestPath, request) {
  const directory = validateParentDirectory(requestPath)
  const temporaryPath = path.join(directory, `.request-${request.jobId}.tmp`)
  let handle
  try {
    handle = fs.openSync(temporaryPath, 'wx', 0o600)
    fs.writeFileSync(handle, `${JSON.stringify(request)}\n`)
    fs.fsyncSync(handle)
    fs.closeSync(handle)
    handle = null
    try {
      fs.linkSync(temporaryPath, requestPath)
    } catch (error) {
      if (error.code === 'EEXIST') throw ipcError('已有更新任务等待处理', 409, 'UPDATE_ALREADY_QUEUED')
      throw error
    }
    fs.unlinkSync(temporaryPath)
    const directoryHandle = fs.openSync(directory, 'r')
    try { fs.fsyncSync(directoryHandle) } finally { fs.closeSync(directoryHandle) }
  } finally {
    if (handle !== null && handle !== undefined) fs.closeSync(handle)
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath)
  }
}

export function createUpdateIpcService({
  enabled = false,
  requestPath = '/run/lenovo-store-updater/request.json',
  processingPath = '/run/lenovo-store-updater/claimed/processing.json',
  statePath = '/var/lib/lenovo-store-updater/status.json',
  requireRootOwnedState = process.env.NODE_ENV === 'production',
} = {}) {
  for (const [name, value] of Object.entries({ requestPath, processingPath, statePath })) {
    if (!path.isAbsolute(value) || path.normalize(value) !== value || value === '/') throw new Error(`${name} 必须是规范的绝对路径`)
  }

  function state() {
    if (!enabled) return null
    try {
      if (fs.existsSync(processingPath)) {
        return fs.existsSync(statePath)
          ? sanitizeState(readSafeJson(statePath, { requireRootOwner: requireRootOwnedState }))
          : null
      }
      if (fs.existsSync(requestPath)) return queuedState(readSafeJson(requestPath))
      if (fs.existsSync(statePath)) return sanitizeState(readSafeJson(statePath, { requireRootOwner: requireRootOwnedState }))
      return null
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  function status() {
    let currentState = null
    let configured = false
    let configurationError = null
    if (enabled) {
      try {
        validateParentDirectory(requestPath)
        validateParentDirectory(statePath)
        currentState = state()
        configured = true
      } catch (error) {
        configurationError = error.message
      }
    }
    return {
      enabled,
      configured,
      active: Boolean(currentState && ACTIVE_STATUSES.has(currentState.status)),
      state: currentState,
      configurationError,
    }
  }

  function requestInstall(tag) {
    if (!enabled) throw ipcError('服务器未启用在线安装', 503, 'UPDATE_INSTALL_DISABLED')
    if (!TAG_PATTERN.test(tag)) throw ipcError('安装版本必须符合 vX.Y.Z', 400, 'INVALID_UPDATE_TAG')
    const snapshot = status()
    if (!snapshot.configured) throw ipcError(snapshot.configurationError || '更新器尚未完成配置', 503, 'UPDATE_NOT_CONFIGURED')
    if (snapshot.active) throw ipcError('已有更新任务正在执行', 409, 'UPDATE_IN_PROGRESS')
    if (fs.existsSync(requestPath) || fs.existsSync(processingPath)) throw ipcError('已有更新任务等待处理', 409, 'UPDATE_ALREADY_QUEUED')
    const request = {
      schemaVersion: 1,
      jobId: crypto.randomUUID(),
      action: 'install',
      tag,
      requestedAt: new Date().toISOString(),
    }
    writeRequestAtomic(requestPath, request)
    return queuedState(request)
  }

  return Object.freeze({ status, requestInstall })
}
