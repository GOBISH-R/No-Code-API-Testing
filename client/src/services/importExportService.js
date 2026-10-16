import api from './api.js';

export async function exportCollection(id) {
  const { data } = await api.get(`/collections/${id}/export`);
  return data;
}

export async function importCollection(document) {
  const { data } = await api.post('/collections/import', document);
  return data;
}

export async function importOpenApi(text) {
  const { data } = await api.post('/collections/import-openapi', { text });
  return data;
}
