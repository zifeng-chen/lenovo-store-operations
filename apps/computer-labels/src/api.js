const API_BASE = '/api/computer-labels';
const REQUEST_TIMEOUT = 30000;

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(!(typeof FormData !== 'undefined' && options.body instanceof FormData) && options.body
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers
      }
    });
    const contentType = response.headers.get('content-type') || '';
    let data;

    if (!response.ok) {
      data = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
      throw new Error(data?.msg || (typeof data === 'string' && data) || `请求失败 (${response.status})`);
    }

    data = options.responseType === 'blob'
      ? await response.blob()
      : contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    return {
      data,
      headers: {
        'content-disposition': response.headers.get('content-disposition') || ''
      }
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，请稍后重试');
    throw new Error(error.message || '请求失败');
  } finally {
    clearTimeout(timeout);
  }
}

export async function getProducts(q = '') {
  const query = q ? `?q=${encodeURIComponent(q)}` : '';
  const response = await request(`/products${query}`);
  return response.data.data;
}

export async function createProduct(payload) {
  const response = await request('/products', { method: 'POST', body: JSON.stringify(payload) });
  return response.data.data;
}

export async function updateProduct(id, payload) {
  const response = await request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  return response.data.data;
}

export function deleteProduct(id) {
  return request(`/products/${id}`, { method: 'DELETE' });
}

export function batchDeleteProducts(ids) {
  return request('/products/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) });
}

export function importProducts(file) {
  const form = new FormData();
  form.append('file', file);
  return request('/products/import', { method: 'POST', body: form });
}

export function exportProducts() {
  return request('/products/export', { responseType: 'blob' });
}

export function backupDatabase() {
  return request('/backup', { responseType: 'blob' });
}

export function restoreDatabase(file) {
  const form = new FormData();
  form.append('file', file);
  return request('/restore', { method: 'POST', body: form });
}
