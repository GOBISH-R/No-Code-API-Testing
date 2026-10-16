import api from './api.js';

export async function fetchMocks() {
  const { data } = await api.get('/mocks');
  return data;
}

export async function createMock(payload) {
  const { data } = await api.post('/mocks', payload);
  return data;
}

export async function updateMock(id, payload) {
  const { data } = await api.put(`/mocks/${id}`, payload);
  return data;
}

export async function deleteMock(id) {
  await api.delete(`/mocks/${id}`);
}
