import { createApiClient } from '@lenovo-store/shared/api-client'

// 销售报表接口直接返回裸对象，不走 {code,data,msg} 信封。
const client = createApiClient('/api/sales-report', { unwrapEnvelope: false })

function buildQuery(params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value)
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

const get = (path, params) => client.get(`${path}${buildQuery(params)}`)

export const getOverview = (params) => get('/overview', params)
export const getTrend = (params) => get('/trend', params)
export const getComparison = (params) => get('/comparison', params)
export const getItems = (params) => get('/items', params)
export const getRecords = (params) => get('/records', params)
