import api from './api.js';

export async function fetchCollections() {
  const { data } = await api.get('/collections');
  return data;
}

export async function createCollection(payload) {
  const { data } = await api.post('/collections', payload);
  return data;
}

export async function updateCollection(id, payload) {
  const { data } = await api.put(`/collections/${id}`, payload);
  return data;
}

export async function deleteCollection(id) {
  await api.delete(`/collections/${id}`);
}
