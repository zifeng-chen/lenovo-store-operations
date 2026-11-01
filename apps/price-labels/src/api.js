import { createApiClient } from '@lenovo-store/shared/api-client'

export const API_BASE = '/api/price-labels'

const client = createApiClient(API_BASE, { unwrapEnvelope: false })

export function apiUrl(path) {
  return `${API_BASE}${path}`
}

export function requestJson(path, options) {
  return client.request(path, options)
}
