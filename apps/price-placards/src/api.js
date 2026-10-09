const API_BASE = '/api/price-placards'
const TIMEOUT = 30000
const LARGE_FILE_TIMEOUT = 10 * 60 * 1000
let maintenanceToken = ''

async function request(url, options = {}) {
  const { responseType, timeoutMs = TIMEOUT, ...fetchOptions } = options
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal })
    const type = response.headers.get('content-type') || ''
    const payload = responseType === 'blob'
      ? await response.blob()
      : type.includes('application/json') ? await response.json() : await response.text()
    if (!response.ok) throw new Error(payload?.msg || payload?.message || payload || `请求失败 (${response.status})`)
    if (responseType === 'blob') return { blob: payload, disposition: response.headers.get('content-disposition') || '' }
    if (payload && typeof payload === 'object' && 'code' in payload) {
      if (payload.code !== 0) throw new Error(payload.msg || '请求失败')
      return payload.data
    }
    return payload
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，请稍后重试')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function json(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export const imageUrl = (id) => `${API_BASE}/images/${id}`
export const getSystemHealth = () => request('/api/system/health')
export const setMaintenanceToken = (value = '') => { maintenanceToken = String(value) }
export const createImageClaim = () => request(`${API_BASE}/image-claims`, { method: 'POST' })
export const releaseImageClaim = (token, { keepalive = false } = {}) => request(`${API_BASE}/image-claims/${encodeURIComponent(token)}`, { method: 'DELETE', keepalive })
export const releaseClaimedImage = (token, id) => request(`${API_BASE}/image-claims/${encodeURIComponent(token)}/images/${id}`, { method: 'DELETE' })
export const listPlacards = () => request(`${API_BASE}/placards`)
export const getPlacard = (id) => request(`${API_BASE}/placards/${id}`)
export const createPlacard = (payload) => request(`${API_BASE}/placards`, json('POST', payload))
export const updatePlacard = (id, payload) => request(`${API_BASE}/placards/${id}`, json('PUT', payload))
export const deletePlacard = (id) => request(`${API_BASE}/placards/${id}`, { method: 'DELETE' })
export const listVersions = (id) => request(`${API_BASE}/placards/${id}/versions`)
export const getVersion = (id, versionId) => request(`${API_BASE}/placards/${id}/versions/${versionId}`)
export const restoreVersion = (id, versionId) => request(`${API_BASE}/placards/${id}/versions/${versionId}/restore`, { method: 'POST' })
export const copyVersion = (id, versionId) => request(`${API_BASE}/placards/${id}/versions/${versionId}/copy`, { method: 'POST' })
export const uploadImage = (payload, claimToken) => request(`${API_BASE}/images`, json('POST', { ...payload, claimToken }))
export const getComputerProducts = () => request('/api/computer-labels/products')
export const getPriceProducts = () => request('/api/price-labels/products')
export const listServiceCatalog = () => request(`${API_BASE}/services`)
export const createServiceCatalogItem = (payload) => request(`${API_BASE}/services`, json('POST', payload))
export const updateServiceCatalogItem = (id, payload) => request(`${API_BASE}/services/${id}`, json('PUT', payload))
export const deleteServiceCatalogItem = (id) => request(`${API_BASE}/services/${id}`, { method: 'DELETE' })
export const exportServiceCatalog = () => request(`${API_BASE}/services/export`, { responseType: 'blob', timeoutMs: LARGE_FILE_TIMEOUT })
export function importServiceCatalog(file) {
  const form = new FormData()
  form.append('file', file)
  return request(`${API_BASE}/services/import`, { method: 'POST', body: form, timeoutMs: LARGE_FILE_TIMEOUT })
}
export const exportJson = () => request(`${API_BASE}/export/json`, { responseType: 'blob', timeoutMs: LARGE_FILE_TIMEOUT })
export const exportDatabase = () => request(`${API_BASE}/export/database`, { responseType: 'blob', timeoutMs: LARGE_FILE_TIMEOUT })

export function importBackup(kind, file, validateOnly, confirmation = '') {
  const form = new FormData()
  form.append('file', file)
  if (confirmation) form.append('confirm', confirmation)
  const query = validateOnly ? '?validateOnly=true' : ''
  const headers = { 'X-Lenovo-Store-Maintenance': '1' }
  if (maintenanceToken) headers.Authorization = `Bearer ${maintenanceToken}`
  return request(`${API_BASE}/import/${kind}${query}`, { method: 'POST', headers, body: form, timeoutMs: LARGE_FILE_TIMEOUT })
}
