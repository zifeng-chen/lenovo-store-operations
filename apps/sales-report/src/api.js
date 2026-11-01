const API_BASE = '/api/sales-report'

function buildQuery(params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value)
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

async function get(path, params) {
  const response = await fetch(`${API_BASE}${path}${buildQuery(params)}`)
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.msg || data?.message || `请求失败（${response.status}）`)
  return data
}

export const getOverview = (params) => get('/overview', params)
export const getTrend = (params) => get('/trend', params)
export const getComparison = (params) => get('/comparison', params)
export const getItems = (params) => get('/items', params)
export const getRecords = (params) => get('/records', params)
