import api from './api.js';

export async function executeRequest(requestConfig) {
  const { data } = await api.post('/requests/execute', requestConfig);
  return data;
}
