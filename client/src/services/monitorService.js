import api from './api.js';

export async function fetchMonitors() {
  const { data } = await api.get('/monitors');
  return data;
}

export async function createMonitor(payload) {
  const { data } = await api.post('/monitors', payload);
  return data;
}

export async function updateMonitor(id, payload) {
  const { data } = await api.put(`/monitors/${id}`, payload);
  return data;
}

export async function deleteMonitor(id) {
  await api.delete(`/monitors/${id}`);
}

export async function sendTestAlert(id) {
  const { data } = await api.post(`/monitors/${id}/test-alert`);
  return data;
}

export async function runMonitor(id) {
  const { data } = await api.post(`/monitors/${id}/run`);
  return data;
}
