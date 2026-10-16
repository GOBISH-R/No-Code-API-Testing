import api from './api.js';

export async function fetchDashboard({ collectionId } = {}) {
  const { data } = await api.get('/dashboard', { params: collectionId ? { collectionId } : {} });
  return data;
}
