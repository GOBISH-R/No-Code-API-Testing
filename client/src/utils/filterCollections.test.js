import { describe, it, expect } from 'vitest';
import { filterCollections } from './filterCollections.js';

const tree = [
  {
    _id: 'c1',
    name: 'Users API',
    folders: [],
    requests: [
      { _id: 'r1', name: 'List users', method: 'GET', url: 'https://api.test/users' },
      { _id: 'r2', name: 'Create user', method: 'POST', url: 'https://api.test/users' },
    ],
  },
  {
    _id: 'c2',
    name: 'Billing',
    folders: [
      { _id: 'f1', name: 'Invoices', parentId: null },
      { _id: 'f2', name: 'Drafts', parentId: 'f1' },
      { _id: 'f3', name: 'Refunds', parentId: null },
    ],
    requests: [
      { _id: 'r3', name: 'Get invoice', method: 'GET', url: '/invoices/1', folderId: 'f1' },
      { _id: 'r4', name: 'Save draft', method: 'PUT', url: '/drafts/9', folderId: 'f2' },
      { _id: 'r5', name: 'Refund', method: 'POST', url: '/refunds', folderId: 'f3' },
    ],
  },
];

describe('filterCollections', () => {
  it('returns everything for an empty query', () => {
    expect(filterCollections(tree, '  ')).toBe(tree);
  });

  it('keeps a whole collection when its name matches', () => {
    const [users] = filterCollections(tree, 'users api');
    expect(users.requests).toHaveLength(2);
  });

  it('matches requests by name, URL or method, case-insensitively', () => {
    expect(filterCollections(tree, 'CREATE')[0].requests.map((r) => r._id)).toEqual(['r2']);
    expect(filterCollections(tree, '/refunds')[0].requests.map((r) => r._id)).toEqual(['r5']);
    expect(filterCollections(tree, 'put')[0].requests.map((r) => r._id)).toEqual(['r4']);
  });

  it('keeps the folder path down to a nested match, and nothing else', () => {
    const [billing] = filterCollections(tree, 'save draft');
    expect(billing.folders.map((f) => f._id).sort()).toEqual(['f1', 'f2']);
    expect(billing.requests.map((r) => r._id)).toEqual(['r4']);
  });

  it('shows the contents of a folder whose name matches', () => {
    const [billing] = filterCollections(tree, 'invoices');
    expect(billing.requests.map((r) => r._id).sort()).toEqual(['r3', 'r4']);
  });

  it('drops collections with no match', () => {
    expect(filterCollections(tree, 'nothing-like-this')).toEqual([]);
  });

  it('survives a folder cycle in bad data', () => {
    const cyclic = [{ _id: 'c', name: 'X', folders: [{ _id: 'a', name: 'A', parentId: 'b' }, { _id: 'b', name: 'B', parentId: 'a' }], requests: [{ _id: 'r', name: 'hit', folderId: 'a' }] }];
    expect(filterCollections(cyclic, 'hit')[0].requests).toHaveLength(1);
  });
});
