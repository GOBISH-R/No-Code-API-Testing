import api from './api.js';

export async function fetchHistory() {
  const { data } = await api.get('/history');
  return data;
}

export async function fetchHistoryEntry(id) {
  const { data } = await api.get(`/history/${id}`);
  return data;
}

export async function deleteHistoryEntry(id) {
  await api.delete(`/history/${id}`);
}

export async function clearHistory() {
  await api.delete('/history');
}
