import { createApiClient } from '@lenovo-store/shared/api-client';

const client = createApiClient('/api/computer-labels', {
  unwrapEnvelope: false
});

async function request(path, options = {}) {
  const { responseType, ...rest } = options;
  if (responseType === 'blob') {
    const { blob, disposition } = await client.request(path, { ...rest, responseType: 'blob' });
    return { data: blob, headers: { 'content-disposition': disposition } };
  }
  const body = await client.request(path, rest);
  return { data: body, headers: { 'content-disposition': '' } };
}

export async function getProducts(q = '') {
  const query = q ? `?q=${encodeURIComponent(q)}` : '';
  const response = await request(`/products${query}`);
  return response.data.data;
}

export async function createProduct(payload) {
  const response = await request('/products', { method: 'POST', body: payload });
  return response.data.data;
}

export async function updateProduct(id, payload) {
  const response = await request(`/products/${id}`, { method: 'PUT', body: payload });
  return response.data.data;
}

export function deleteProduct(id) {
  return request(`/products/${id}`, { method: 'DELETE' });
}

export function batchDeleteProducts(ids) {
  return request('/products/batch-delete', { method: 'POST', body: { ids } });
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
