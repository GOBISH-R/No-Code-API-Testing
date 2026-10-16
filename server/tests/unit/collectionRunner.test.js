import { describe, it, expect, vi, beforeEach } from 'vitest';

// The runner's collaborators are mocked rather than stood up: this suite is offline and
// database-free by design, and what needs proving here is how iterations compose
// variables — not that Mongoose saves documents.
vi.mock('../../src/services/collections/collectionService.js', () => ({
  getCollectionWithRequests: vi.fn(),
}));
vi.mock('../../src/models/TestRun.js', () => ({
  TestRun: { create: vi.fn(async (doc) => doc) },
}));
vi.mock('../../src/services/execution/executionEngine.js', () => ({
  executeRequest: vi.fn(),
}));

const { getCollectionWithRequests } = await import('../../src/services/collections/collectionService.js');
const { executeRequest } = await import('../../src/services/execution/executionEngine.js');
const { runCollection } = await import('../../src/services/runner/collectionRunner.js');

function okResponse(body = {}) {
  return {
    success: true,
    response: { status: 200, headers: {}, body, size: 10 },
    meta: { time: 5 },
  };
}

function collection(requests) {
  return { _id: 'c1', name: 'Suite', requests };
}

// Any id will do: the collaborators are mocked, so this only has to be present.
const OWNER = '000000000000000000000001';

const plainRequest = { _id: 'r1', name: 'Get user', protocol: 'rest', method: 'GET', url: 'https://x/u' };

beforeEach(() => {
  vi.clearAllMocks();
  executeRequest.mockResolvedValue(okResponse());
});

describe('runCollection without a dataset', () => {
  it('runs each request once and records no iteration', async () => {
    getCollectionWithRequests.mockResolvedValue(collection([plainRequest]));

    const run = await runCollection(OWNER, 'c1', { variables: { host: 'x' } });

    expect(executeRequest).toHaveBeenCalledTimes(1);
    expect(run.iterationCount).toBe(1);
    expect(run.results[0].iteration).toBeNull();
    expect(run.results[0].iterationLabel).toBe('');
  });
});

describe('runCollection with a dataset', () => {
  it('runs the whole collection once per row', async () => {
    getCollectionWithRequests.mockResolvedValue(collection([plainRequest, { ...plainRequest, _id: 'r2' }]));

    const run = await runCollection(OWNER, 'c1', {
      dataset: [{ id: '1' }, { id: '2' }, { id: '3' }],
    });

    expect(executeRequest).toHaveBeenCalledTimes(6);
    expect(run.iterationCount).toBe(3);
    expect(run.requestCount).toBe(6);
    expect(run.results.map((r) => r.iteration)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('supplies each row as variables', async () => {
    getCollectionWithRequests.mockResolvedValue(collection([plainRequest]));

    await runCollection(OWNER, 'c1', { dataset: [{ userId: '7' }, { userId: '8' }] });

    expect(executeRequest.mock.calls[0][1]).toMatchObject({ userId: '7' });
    expect(executeRequest.mock.calls[1][1]).toMatchObject({ userId: '8' });
  });

  it('lets a row override an environment variable', async () => {
    // The row is this iteration's input, so it is the more specific layer.
    getCollectionWithRequests.mockResolvedValue(collection([plainRequest]));

    await runCollection(OWNER, 'c1', {
      variables: { userId: 'from-environment', host: 'api.example.com' },
      dataset: [{ userId: 'from-row' }],
    });

    expect(executeRequest.mock.calls[0][1]).toMatchObject({
      userId: 'from-row',
      host: 'api.example.com',
    });
  });

  it('labels each result with the row it came from', async () => {
    getCollectionWithRequests.mockResolvedValue(collection([plainRequest]));

    const run = await runCollection(OWNER, 'c1', {
      dataset: [{ email: 'ada@example.com' }, { email: 'grace@example.com' }],
    });

    expect(run.results.map((r) => r.iterationLabel)).toEqual([
      'email=ada@example.com',
      'email=grace@example.com',
    ]);
  });

  it('does not carry captures from one iteration into the next', async () => {
    // The failure this prevents: row 2 passing on a token captured during row 1, so a
    // dataset that should expose a broken login reports green.
    getCollectionWithRequests.mockResolvedValue(
      collection([
        { ...plainRequest, captures: [{ source: 'json', path: '$.token', variableName: 'token' }] },
        { ...plainRequest, _id: 'r2' },
      ]),
    );
    executeRequest.mockResolvedValue(okResponse({ token: 'abc' }));

    await runCollection(OWNER, 'c1', { dataset: [{ id: '1' }, { id: '2' }] });

    const [firstOfRowOne, secondOfRowOne, firstOfRowTwo] = executeRequest.mock.calls.map((c) => c[1]);
    expect(firstOfRowOne.token).toBeUndefined();
    // Still available to later requests within the same iteration.
    expect(secondOfRowOne.token).toBe('abc');
    // But gone again at the start of the next one.
    expect(firstOfRowTwo.token).toBeUndefined();
  });

  it('keeps going after a row fails', async () => {
    getCollectionWithRequests.mockResolvedValue(collection([plainRequest]));
    executeRequest
      .mockResolvedValueOnce({ success: false, error: { message: 'Bad request' } })
      .mockResolvedValue(okResponse());

    const run = await runCollection(OWNER, 'c1', { dataset: [{ id: 'bad' }, { id: 'good' }] });

    expect(run.results).toHaveLength(2);
    expect(run.results[0].success).toBe(false);
    expect(run.results[1].success).toBe(true);
    expect(run.status).toBe('error');
  });
});
