const API_BASE = '/api/receipt-assistant'

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

export async function request(path, { method = 'GET', body, headers = {}, signal, timeout = 10000 } = {}) {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(signal?.reason)
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), timeout)

  let payload = body
  const requestHeaders = { ...headers }
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    payload = JSON.stringify(body)
    requestHeaders['Content-Type'] = 'application/json'
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      body: payload,
      headers: requestHeaders,
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') || ''
    const data = contentType.includes('application/json') ? await response.json() : await response.text()
    if (!response.ok) throw new ApiError(data?.message || `请求失败（${response.status}）`, response.status, data)
    return data
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted && !signal?.aborted) throw new ApiError('请求超时，请稍后重试', 504, null)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}
