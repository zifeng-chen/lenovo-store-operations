/**
 * 各业务模块共用的请求封装。
 * 统一处理：超时、JSON 序列化、Blob/FormData、{code,data,msg} 信封解包和错误消息提取。
 */

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export const MAINTENANCE_HEADER = { 'X-Lenovo-Store-Maintenance': '1' };

function isPlainBody(body) {
  return body !== undefined
    && body !== null
    && !(body instanceof FormData)
    && !(body instanceof Blob)
    && !(body instanceof ArrayBuffer);
}

function extractMessage(payload, status) {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload === 'object') {
    const message = payload.msg || payload.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return `请求失败 (${status})`;
}

export function createApiClient(apiBase, options = {}) {
  const {
    defaultTimeout = 30000,
    unwrapEnvelope = true,
    timeoutMessage = '请求超时，请稍后重试'
  } = options;

  async function request(path, requestOptions = {}) {
    const {
      method = 'GET',
      body,
      headers = {},
      signal,
      timeout = defaultTimeout,
      timeoutMs,
      responseType,
      keepalive = false
    } = requestOptions;
    const effectiveTimeout = timeoutMs ?? timeout;

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });

    const timer = setTimeout(
      () => controller.abort(new DOMException(timeoutMessage, 'TimeoutError')),
      effectiveTimeout
    );

    const requestHeaders = { ...headers };
    let payload = body;
    if (isPlainBody(body)) {
      payload = JSON.stringify(body);
      requestHeaders['Content-Type'] = 'application/json';
    }

    try {
      const url = /^https?:\/\//.test(path) || path.startsWith('/api/') ? path : `${apiBase}${path}`;
      const response = await fetch(url, {
        method,
        body: payload,
        headers: requestHeaders,
        signal: controller.signal,
        keepalive
      });

      if (responseType === 'blob') {
        if (!response.ok) {
          const contentType = response.headers.get('content-type') || '';
          const detail = contentType.includes('application/json')
            ? await response.json().catch(() => null)
            : await response.text().catch(() => '');
          throw new ApiError(extractMessage(detail, response.status), response.status, detail);
        }
        return {
          blob: await response.blob(),
          disposition: response.headers.get('content-disposition') || ''
        };
      }

      if (response.status === 204) return null;

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await response.json().catch(() => null)
        : await response.text().catch(() => '');

      if (!response.ok) {
        throw new ApiError(extractMessage(data, response.status), response.status, data);
      }

      if (unwrapEnvelope && data && typeof data === 'object' && 'code' in data) {
        if (data.code !== 0) throw new ApiError(extractMessage(data, response.status), response.status, data);
        return data.data;
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        if (signal?.aborted) throw error;
        throw new ApiError(timeoutMessage, 0, null);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  return {
    request,
    apiBase,
    get: (path, opts) => request(path, { ...opts, method: 'GET' }),
    post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
    put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
    del: (path, opts) => request(path, { ...opts, method: 'DELETE' })
  };
}
