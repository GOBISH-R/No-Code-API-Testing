import api from './api.js';

export async function fetchTestRuns({ collectionId } = {}) {
  const { data } = await api.get('/test-runs', { params: collectionId ? { collectionId } : {} });
  return data;
}

export async function fetchTestRun(id) {
  const { data } = await api.get(`/test-runs/${id}`);
  return data;
}
