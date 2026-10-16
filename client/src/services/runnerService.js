import api from './api.js';

export async function runCollection(collectionId, payload) {
  const { data } = await api.post(`/collections/${collectionId}/run`, payload);
  return data;
}
