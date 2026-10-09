import crypto from 'node:crypto'

const AUTH_WINDOW_MS = 15 * 60 * 1000
const MAX_AUTH_FAILURES = 5

function sameOrigin(request) {
  const origin = request.get('Origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === `${request.protocol}://${request.get('host')}`
  } catch {
    return false
  }
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
      const values = recentFailures(key)
      values.push(Date.now())
      failures.set(key, values)
      return response.status(401).json({ code: 1, data: null, msg: '系统维护令牌无效' })
    }
    failures.delete(key)
    return next()
  }
}
