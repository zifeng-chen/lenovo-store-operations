import crypto from 'node:crypto'
import express, { Router } from 'express'

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const AUTH_WINDOW_MS = 15 * 60 * 1000
const MAX_AUTH_FAILURES = 5

function apiSuccess(response, data, message = 'success', status = 200) {
  response.status(status).json({ code: 0, data, msg: message })
}

function apiError(message, status = 400, code = 'UPDATE_REQUEST_ERROR') {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function sameOrigin(request) {
  const origin = request.get('Origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === `${request.protocol}://${request.get('host')}`
  } catch {
    return false
  }
}

function requireSameOrigin(request, response, next) {
  if (!request.get('Origin')) return response.status(403).json({ code: 1, data: null, msg: '检查系统更新必须来自同源页面' })
  if (!sameOrigin(request)) return response.status(403).json({ code: 1, data: null, msg: '仅允许同源检查系统更新' })
  return next()
}

function matchesToken(value, expected) {
  const actual = Buffer.from(value || '')
  const wanted = Buffer.from(expected || '')
  return actual.length === wanted.length && wanted.length > 0 && crypto.timingSafeEqual(actual, wanted)
}

function createInstallAuthorizer({ updateToken, publicOrigin }) {
  const failures = new Map()
  function failureKey(request) {
    return request.ip || request.socket.remoteAddress || 'unknown'
  }
  function recentFailures(key) {
    const cutoff = Date.now() - AUTH_WINDOW_MS
    const values = (failures.get(key) || []).filter(value => value >= cutoff)
    if (values.length) failures.set(key, values)
    else failures.delete(key)
    return values
  }
  function recordFailure(key) {
    const values = recentFailures(key)
    values.push(Date.now())
    failures.set(key, values)
  }

  return function authorizeInstall(request, response, next) {
    const key = failureKey(request)
    if (recentFailures(key).length >= MAX_AUTH_FAILURES) {
      response.set('Retry-After', String(AUTH_WINDOW_MS / 1000))
      return response.status(429).json({ code: 1, data: null, msg: '更新身份验证失败次数过多，请稍后重试' })
    }
    if (!updateToken || !publicOrigin) return response.status(503).json({ code: 1, data: null, msg: '在线安装尚未完成安全配置' })
    if (request.get('X-Lenovo-Store-Update') !== '1') return response.status(403).json({ code: 1, data: null, msg: '缺少在线更新请求标识' })
    if (request.get('Sec-Fetch-Site') === 'cross-site') return response.status(403).json({ code: 1, data: null, msg: '禁止跨站发起在线更新' })
    let origin
    try {
      origin = new URL(request.get('Origin') || '').origin
    } catch {
      return response.status(403).json({ code: 1, data: null, msg: '在线安装必须来自配置的 Portal 地址' })
    }
    if (origin !== publicOrigin) return response.status(403).json({ code: 1, data: null, msg: '在线安装必须来自配置的 Portal 地址' })
    const authorization = request.get('Authorization') || ''
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!matchesToken(suppliedToken, updateToken)) {
      recordFailure(key)
      return response.status(401).json({ code: 1, data: null, msg: '在线更新管理员令牌无效' })
    }
    failures.delete(key)
    return next()
  }
}

export function createSystemUpdateRouter({ releaseService, ipcService, updateToken = '', publicOrigin = '' } = {}) {
  if (!releaseService) throw new Error('系统更新路由缺少 Release 检查服务')
  if (!ipcService) throw new Error('系统更新路由缺少更新器 IPC 服务')
  const router = Router()
  const authorizeInstall = createInstallAuthorizer({ updateToken, publicOrigin })
  const jsonParser = express.json({ limit: '2kb', strict: true })

  function snapshot() {
    return { ...releaseService.status(), installation: ipcService.status() }
  }

  router.use((_request, response, next) => {
    response.removeHeader('Access-Control-Allow-Origin')
    response.set('Cache-Control', 'no-store')
    return next()
  })

  router.get('/status', (_request, response, next) => {
    try {
      return apiSuccess(response, snapshot())
    } catch (error) {
      return next(error)
    }
  })

  router.post('/check', requireSameOrigin, async (_request, response, next) => {
    try {
      const result = await releaseService.check()
      return apiSuccess(response, { ...result, installation: ipcService.status() }, result.lastError ? '已保留上次成功的更新信息' : 'GitHub 更新检查完成')
    } catch (error) {
      return next(error)
    }
  })

  router.post('/install', authorizeInstall, jsonParser, (request, response, next) => {
    try {
      if (!request.is('application/json')) throw apiError('安装请求必须使用 application/json', 415, 'INVALID_CONTENT_TYPE')
      if (!request.body || Object.keys(request.body).sort().join(',') !== 'tag') throw apiError('安装请求只能包含 tag 字段')
      const tag = String(request.body.tag || '')
      if (!TAG_PATTERN.test(tag)) throw apiError('安装版本必须符合 vX.Y.Z')
      const release = releaseService.status()
      if (!release.checkedAt || release.stale || release.lastError) throw apiError('必须先成功获取最新 Release，缓存或失败结果不能用于安装', 409, 'UPDATE_CHECK_REQUIRED')
      if (!release.updateAvailable || !release.latestRelease) throw apiError('当前没有可安装的新稳定版本', 409, 'NO_UPDATE_AVAILABLE')
      if (release.latestRelease.tag !== tag) throw apiError('只能安装服务端刚刚检查到的最新稳定版本', 409, 'UPDATE_TAG_MISMATCH')
      const state = ipcService.requestInstall(tag)
      return apiSuccess(response, { ...release, installation: { ...ipcService.status(), state } }, `已提交 ${tag} 安装任务`, 202)
    } catch (error) {
      return next(error)
    }
  })

  return router
}
