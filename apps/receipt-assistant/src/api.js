import { createApiClient, ApiError } from '@lenovo-store/shared/api-client'

const client = createApiClient('/api/receipt-assistant', {
  defaultTimeout: 10000,
  unwrapEnvelope: false,
})

export { ApiError }

export function request(path, options) {
  return client.request(path, options)
}
