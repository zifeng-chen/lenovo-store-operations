const BASE = '/api/price-tags'

async function request(url, options = {}) {
  const response = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.msg || `请求失败（HTTP ${response.status}）`)
  }
  const body = await response.json()
  if (body?.code !== 0) throw new Error(body?.msg || '请求失败')
  return body.data
}

export const api = {
  listCards: () => request('/cards'),
  createCard: (card) => request('/cards', { method: 'POST', body: JSON.stringify(card) }),
  updateCard: (id, card) => request(`/cards/${id}`, { method: 'PUT', body: JSON.stringify(card) }),
  deleteCard: (id) => request(`/cards/${id}`, { method: 'DELETE' }),
  updateSelection: (ids) => request('/cards/selection', { method: 'PUT', body: JSON.stringify({ ids }) }),
  recalcSubsidy: () => request('/cards/recalc', { method: 'POST' }),
  accessories: () => request('/accessories'),
  services: () => request('/services'),
  createService: (payload) => request('/services', { method: 'POST', body: JSON.stringify(payload) }),
  updateService: (id, payload) => request(`/services/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteService: (id) => request(`/services/${id}`, { method: 'DELETE' }),
  featureCopies: (category) => request(`/feature-copies${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  createFeatureCopy: (payload) => request('/feature-copies', { method: 'POST', body: JSON.stringify(payload) }),
  updateFeatureCopy: (id, payload) => request(`/feature-copies/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteFeatureCopy: (id) => request(`/feature-copies/${id}`, { method: 'DELETE' }),
  icons: () => request('/icons'),
  subsidyConfig: () => request('/subsidy-config')
}

// 更新防抖：同一展牌的连续编辑合并为一次请求，避免每个字符都打数据库
export function createDebouncedUpdater(delay = 400) {
  const timers = new Map()
  const pending = new Map()
  const chains = new Map()

  function flush(key) {
    if (!pending.has(key)) return
    const value = pending.get(key)
    pending.delete(key)
    const prev = chains.get(key) || Promise.resolve()
    const next = prev.catch(() => undefined).then(() => api.updateCard(key, value))
    chains.set(key, next)
  }

  function write(id, card) {
    pending.set(id, JSON.parse(JSON.stringify(card)))
    if (timers.has(id)) clearTimeout(timers.get(id))
    timers.set(id, setTimeout(() => {
      timers.delete(id)
      flush(id)
    }, delay))
  }

  function flushAll() {
    for (const id of [...timers.keys()]) {
      clearTimeout(timers.get(id))
      timers.delete(id)
      flush(id)
    }
  }

  return { write, flushAll }
}
