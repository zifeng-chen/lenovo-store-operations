import { createApiClient } from '@lenovo-store/shared/api-client';

// 出样标签只读仓库货品数据，不写入、不单独建库。
const client = createApiClient('/api/computer-labels', {
  unwrapEnvelope: false
});

export async function getProducts(q = '') {
  const query = q ? `?q=${encodeURIComponent(q)}` : '';
  const body = await client.request(`/products${query}`);
  return body.data;
}
