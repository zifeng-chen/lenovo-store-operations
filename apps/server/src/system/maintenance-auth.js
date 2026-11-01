import crypto from 'node:crypto'

const AUTH_WINDOW_MS = 15 * 60 * 1000
const MAX_AUTH_FAILURES = 5
const MAX_TRACKED_CLIENTS = 10000

function normalizeOrigin(value) {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function sameOrigin(request) {
  const expected = `${request.protocol}://${request.get('host')}`
  const origin = request.get('Origin')

  // Origin 优先；存在就必须完全一致。
  if (origin) return normalizeOrigin(origin) === expected

  // 无 Origin 时（同源 GET、部分表单提交）退化为校验 Referer，
  // 仍未携带则放行——浏览器跨站请求必带 Origin，此处不构成绕过路径。
  const referer = request.get('Referer')
  if (referer) return normalizeOrigin(referer) === expected

  return true
}

function matchesToken(value, expected) {
  const actual = Buffer.from(value || '')
  const wanted = Buffer.from(expected || '')
  return actual.length === wanted.length && wanted.length > 0 && crypto.timingSafeEqual(actual, wanted)
}

export function createSameOriginAuthorizer(message = '此操作必须来自同源页面') {
  return function authorizeSameOrigin(request, response, next) {
    response.removeHeader('Access-Control-Allow-Origin')
    response.set('Cache-Control', 'no-store')
    if (request.get('Sec-Fetch-Site') === 'cross-site' || !sameOrigin(request)) {
      return response.status(403).json({ code: 1, data: null, msg: message })
    }
    return next()
  }
}

export function createMaintenanceAuthorizer({ maintenanceToken = '', operation = '系统维护' } = {}) {
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

  // 记录失败时限制 Map 规模，避免大量不同来源地址撑爆内存。
  function recordFailure(key) {
    if (!failures.has(key) && failures.size >= MAX_TRACKED_CLIENTS) {
      const oldest = failures.keys().next()
      if (!oldest.done) failures.delete(oldest.value)
    }
    const values = recentFailures(key)
    values.push(Date.now())
    failures.set(key, values)
  }

  return function authorizeMaintenance(request, response, next) {
    response.removeHeader('Access-Control-Allow-Origin')
    response.set('Cache-Control', 'no-store')
    if (request.get('X-Lenovo-Store-Maintenance') !== '1') {
      return response.status(403).json({ code: 1, data: null, msg: '缺少系统维护请求标识' })
    }
    if (request.get('Sec-Fetch-Site') === 'cross-site' || !sameOrigin(request)) {
      return response.status(403).json({ code: 1, data: null, msg: `${operation}必须来自同源页面` })
    }
    if (!maintenanceToken) return next()

    const key = failureKey(request)
    if (recentFailures(key).length >= MAX_AUTH_FAILURES) {
      response.set('Retry-After', String(AUTH_WINDOW_MS / 1000))
      return response.status(429).json({ code: 1, data: null, msg: '维护身份验证失败次数过多，请稍后重试' })
    }
    const authorization = request.get('Authorization') || ''
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!matchesToken(suppliedToken, maintenanceToken)) {
      recordFailure(key)
      return response.status(401).json({ code: 1, data: null, msg: '系统维护令牌无效' })
    }
    failures.delete(key)
    return next()
  }
}
