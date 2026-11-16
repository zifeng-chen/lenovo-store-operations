import { createApiClient } from '@lenovo-store/shared/api-client';

const client = createApiClient('/api/sample-devices', { unwrapEnvelope: true });

export const request = (path, options = {}) => client.request(path, options);

export const getDevices = (params = {}) => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.group) query.set('group', params.group);
  if (params.search) query.set('search', params.search);
  const suffix = query.toString() ? `?${query}` : '';
  return request(`/devices${suffix}`);
};

export const getDeviceStats = () => request('/devices/stats');
export const getGroups = () => request('/devices/groups');
export const createDevice = (payload) => request('/devices', { method: 'POST', body: payload });
export const updateDevice = (id, payload) => request(`/devices/${id}`, { method: 'PUT', body: payload });
export const deleteDevice = (id) => request(`/devices/${id}`, { method: 'DELETE' });
export const batchDeleteDevices = (deviceIds) =>
  request('/devices/batch-delete', { method: 'POST', body: { device_ids: deviceIds } });
export const batchSetGroup = (deviceIds, groupName) =>
  request('/devices/batch-group', { method: 'POST', body: { device_ids: deviceIds, group_name: groupName } });
export const importIpRange = (payload) =>
  request('/devices/import/ip-range', { method: 'POST', body: payload });
export const importCsv = (rows, groupName) =>
  request('/devices/import/csv', { method: 'POST', body: { rows, group_name: groupName } });

export const getTasks = (limit = 100) => request(`/tasks?limit=${limit}`);
export const getTask = (id) => request(`/tasks/${id}`);
export const createTask = (payload) => request('/tasks', { method: 'POST', body: payload });
export const cancelTask = (id) => request(`/tasks/${id}/cancel`, { method: 'POST' });

export const getAuditLogs = (params = {}) => {
  const query = new URLSearchParams({ page: String(params.page ?? 1), size: String(params.size ?? 50) });
  if (params.action) query.set('action', params.action);
  return request(`/audit?${query}`);
};
export const getAuditActions = () => request('/audit/actions');

export const getServerUrl = () => request('/deploy/server-url');
export const generateDeviceToken = (payload) => request('/deploy/generate-token', { method: 'POST', body: payload });
export const getUploads = () => request('/uploads');
export const getLatestAgent = () => request('/uploads/agent/latest');

export async function downloadDeployPackage() {
  const response = await fetch('/api/sample-devices/deploy/package', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ msg: '生成部署包失败' }));
    throw new Error(payload.msg || '生成部署包失败');
  }
  return response.blob();
}

export async function uploadAgentExe(file) {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/sample-devices/uploads/agent', { method: 'POST', body: form });
  const payload = await response.json();
  if (payload.code !== 0) throw new Error(payload.msg || '上传失败');
  return payload.data;
}

export async function uploadDistributionFile(file) {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/sample-devices/uploads/file', { method: 'POST', body: form });
  const payload = await response.json();
  if (payload.code !== 0) throw new Error(payload.msg || '上传失败');
  return payload.data;
}
