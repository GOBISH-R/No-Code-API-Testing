import api from './api.js';

export async function createFolder(payload) {
  const { data } = await api.post('/folders', payload);
  return data;
}

export async function renameFolder(id, name) {
  const { data } = await api.put(`/folders/${id}`, { name });
  return data;
}

export async function deleteFolder(id) {
  await api.delete(`/folders/${id}`);
}
