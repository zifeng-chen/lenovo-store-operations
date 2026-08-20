export const API_BASE = '/api/price-labels'

export function apiUrl(path) {
  return `${API_BASE}${path}`
}

export async function requestJson(path, options) {
  const response = await fetch(apiUrl(path), options)
  if (response.status === 204) return null

  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || data.msg || '请求失败，请稍后重试')
  return data
}
