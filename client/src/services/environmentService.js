import api from './api.js';

export async function fetchEnvironments() {
  const { data } = await api.get('/environments');
  return data;
}

export async function createEnvironment(payload) {
  const { data } = await api.post('/environments', payload);
  return data;
}

export async function updateEnvironment(id, payload) {
  const { data } = await api.put(`/environments/${id}`, payload);
  return data;
}

export async function deleteEnvironment(id) {
  await api.delete(`/environments/${id}`);
}
