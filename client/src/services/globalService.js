import api from './api.js';

export async function fetchGlobals() {
  const { data } = await api.get('/globals');
  return data;
}

export async function updateGlobals(payload) {
  const { data } = await api.put('/globals', payload);
  return data;
}
