import express, { Router } from 'express'
import { createMaintenanceAuthorizer, createSameOriginAuthorizer } from './maintenance-auth.js'

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function apiSuccess(response, data, message = 'success', status = 200) {
  response.status(status).json({ code: 0, data, msg: message })
}

function apiError(message, status = 400, code = 'UPDATE_REQUEST_ERROR') {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

export function createSystemUpdateRouter({ releaseService, ipcService, maintenanceToken = '' } = {}) {
  if (!releaseService) throw new Error('系统更新路由缺少 Release 检查服务')
  if (!ipcService) throw new Error('系统更新路由缺少更新器 IPC 服务')
  const router = Router()
  const authorizeInstall = createMaintenanceAuthorizer({ maintenanceToken, operation: '在线更新' })
  const requireSameOrigin = createSameOriginAuthorizer('检查系统更新必须来自同源页面')
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
