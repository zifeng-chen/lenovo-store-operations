import { Router } from 'express'

function apiSuccess(response, data, message = 'success') {
  response.json({ code: 0, data, msg: message })
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

export function createSystemUpdateRouter({ releaseService } = {}) {
  if (!releaseService) throw new Error('系统更新路由缺少 Release 检查服务')
  const router = Router()

  router.use((_request, response, next) => {
    response.removeHeader('Access-Control-Allow-Origin')
    response.set('Cache-Control', 'no-store')
    return next()
  })

  router.get('/status', (_request, response, next) => {
    try {
      return apiSuccess(response, releaseService.status())
    } catch (error) {
      return next(error)
    }
  })

  router.post('/check', requireSameOrigin, async (_request, response, next) => {
    try {
      const result = await releaseService.check()
      return apiSuccess(response, result, result.lastError ? '已保留上次成功的更新信息' : 'GitHub 更新检查完成')
    } catch (error) {
      return next(error)
    }
  })

  return router
}

export default createSystemUpdateRouter
