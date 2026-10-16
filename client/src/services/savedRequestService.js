import api from './api.js';

export async function createSavedRequest(payload) {
  const { data } = await api.post('/requests', payload);
  return data;
}

export async function updateSavedRequest(id, payload) {
  const { data } = await api.put(`/requests/${id}`, payload);
  return data;
}

export async function deleteSavedRequest(id) {
  await api.delete(`/requests/${id}`);
}
