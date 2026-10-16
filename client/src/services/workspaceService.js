import api from './api.js';

const data = (promise) => promise.then((res) => res.data);

export const fetchWorkspaces = () => data(api.get('/workspaces'));
export const createWorkspace = (name) => data(api.post('/workspaces', { name }));
export const renameWorkspace = (id, name) => data(api.put(`/workspaces/${id}`, { name }));
export const deleteWorkspace = (id) => data(api.delete(`/workspaces/${id}`));

export const fetchMembers = (id) => data(api.get(`/workspaces/${id}/members`));
export const inviteMember = (id, email, role) => data(api.post(`/workspaces/${id}/invites`, { email, role }));
export const revokeInvite = (id, inviteId) => data(api.delete(`/workspaces/${id}/invites/${inviteId}`));
export const changeRole = (id, memberId, role) => data(api.put(`/workspaces/${id}/members/${memberId}`, { role }));
export const removeMember = (id, memberId) => data(api.delete(`/workspaces/${id}/members/${memberId}`));

export const fetchMyInvites = () => data(api.get('/workspaces/invites'));
export const acceptInvite = (inviteId) => data(api.post(`/workspaces/invites/${inviteId}/accept`));
export const declineInvite = (inviteId) => data(api.post(`/workspaces/invites/${inviteId}/decline`));
