import { describe, it, expect, vi, beforeEach } from 'vitest';

// The executor is mocked so each hop's config can be inspected: what matters here is
// which URLs are attempted and what is sent with them, not the transport.
vi.mock('../../src/services/execution/requestExecutor.js', () => ({
  executeHttpRequest: vi.fn(),
}));

const { executeHttpRequest } = await import('../../src/services/execution/requestExecutor.js');
const { executeRequest } = await import('../../src/services/execution/executionEngine.js');

function redirect(status, location) {
  return {
    success: true,
    meta: { time: 1 },
    response: { status, statusText: '', headers: { location }, body: null, size: 0 },
    error: null,
  };
}

function ok(body = 'done') {
  return {
    success: true,
    meta: { time: 1 },
    response: { status: 200, statusText: 'OK', headers: {}, body, size: 4 },
    error: null,
  };
}

function request(overrides = {}) {
  return {
    protocol: 'rest',
    method: 'GET',
    url: 'https://example.com/start',
    params: [],
    headers: [],
    body: { mode: 'none' },
    auth: { type: 'none' },
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('redirects are re-validated, not followed blindly', () => {
  it('refuses a redirect to cloud metadata', async () => {
    // The attack the SSRF guard exists to stop, reached the one way the guard used to
    // miss: a perfectly public first URL that answers 302 with a link-local Location.
    executeHttpRequest.mockResolvedValueOnce(
      redirect(302, 'http://169.254.169.254/latest/meta-data/iam/security-credentials/'),
    );

    const result = await executeRequest(request());

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('REDIRECT_BLOCKED');
    // Crucially, the second hop was never attempted.
    expect(executeHttpRequest).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to localhost', async () => {
    executeHttpRequest.mockResolvedValueOnce(redirect(301, 'http://127.0.0.1:5000/api/health'));

    const result = await executeRequest(request());

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('REDIRECT_BLOCKED');
    expect(executeHttpRequest).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a private network address', async () => {
    executeHttpRequest.mockResolvedValueOnce(redirect(302, 'http://10.0.0.1/admin'));

    const result = await executeRequest(request());

    expect(result.error.code).toBe('REDIRECT_BLOCKED');
  });

  it('still follows an ordinary public redirect', async () => {
    executeHttpRequest
      .mockResolvedValueOnce(redirect(302, 'https://example.org/moved'))
      .mockResolvedValueOnce(ok());

    const result = await executeRequest(request());

    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    expect(executeHttpRequest.mock.calls[1][0].url).toBe('https://example.org/moved');
    expect(result.meta.redirects).toEqual([{ status: 302, url: 'https://example.org/moved' }]);
  });

  it('resolves a relative Location against the current URL', async () => {
    executeHttpRequest
      .mockResolvedValueOnce(redirect(302, '/elsewhere'))
      .mockResolvedValueOnce(ok());

    await executeRequest(request());

    expect(executeHttpRequest.mock.calls[1][0].url).toBe('https://example.com/elsewhere');
  });

  it('gives up rather than looping forever', async () => {
    executeHttpRequest.mockResolvedValue(redirect(302, 'https://example.com/again'));

    const result = await executeRequest(request());

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('TOO_MANY_REDIRECTS');
    expect(executeHttpRequest).toHaveBeenCalledTimes(6); // the original plus 5 hops
  });
});

describe('credentials are not carried across origins', () => {
  it('drops the Authorization header when the host changes', async () => {
    // Otherwise one redirect is enough to hand the user's token to a host they never
    // addressed — a credential leak, not merely an SSRF.
    executeHttpRequest
      .mockResolvedValueOnce(redirect(302, 'https://example.org/moved'))
      .mockResolvedValueOnce(ok());

    await executeRequest(request({ auth: { type: 'bearer', bearer: { token: 'secret-token' } } }));

    const first = executeHttpRequest.mock.calls[0][0];
    const second = executeHttpRequest.mock.calls[1][0];
    expect(first.headers.Authorization).toBe('Bearer secret-token');
    expect(second.headers.Authorization).toBeUndefined();
  });

  it('keeps the Authorization header on a same-origin redirect', async () => {
    executeHttpRequest
      .mockResolvedValueOnce(redirect(302, 'https://example.com/next'))
      .mockResolvedValueOnce(ok());

    await executeRequest(request({ auth: { type: 'bearer', bearer: { token: 'secret-token' } } }));

    expect(executeHttpRequest.mock.calls[1][0].headers.Authorization).toBe('Bearer secret-token');
  });
});

describe('redirect method semantics', () => {
  it('downgrades a POST to GET on 302 and drops the body', async () => {
    executeHttpRequest
      .mockResolvedValueOnce(redirect(302, 'https://example.com/next'))
      .mockResolvedValueOnce(ok());

    await executeRequest(
      request({ method: 'POST', body: { mode: 'json', raw: '{"a":1}' } }),
    );

    const second = executeHttpRequest.mock.calls[1][0];
    expect(second.method).toBe('GET');
    expect(second.data).toBeUndefined();
  });

  it('preserves the method and body on 307', async () => {
    executeHttpRequest
      .mockResolvedValueOnce(redirect(307, 'https://example.com/next'))
      .mockResolvedValueOnce(ok());

    await executeRequest(request({ method: 'POST', body: { mode: 'json', raw: '{"a":1}' } }));

    const second = executeHttpRequest.mock.calls[1][0];
    expect(second.method).toBe('POST');
    expect(second.data).toBe('{"a":1}');
  });

  it('forces GET on 303 even from a POST', async () => {
    executeHttpRequest
      .mockResolvedValueOnce(redirect(303, 'https://example.com/result'))
      .mockResolvedValueOnce(ok());

    await executeRequest(request({ method: 'POST', body: { mode: 'json', raw: '{"a":1}' } }));

    expect(executeHttpRequest.mock.calls[1][0].method).toBe('GET');
  });
});

describe('non-redirect responses are unaffected', () => {
  it('returns a 200 as-is with no redirect metadata', async () => {
    executeHttpRequest.mockResolvedValueOnce(ok());

    const result = await executeRequest(request());

    expect(result.response.status).toBe(200);
    expect(result.meta.redirects).toBeUndefined();
    expect(executeHttpRequest).toHaveBeenCalledTimes(1);
  });

  it('returns a 3xx with no Location as the final response', async () => {
    executeHttpRequest.mockResolvedValueOnce({
      success: true,
      meta: { time: 1 },
      response: { status: 304, statusText: '', headers: {}, body: null, size: 0 },
      error: null,
    });

    const result = await executeRequest(request());

    expect(result.response.status).toBe(304);
    expect(executeHttpRequest).toHaveBeenCalledTimes(1);
  });
});
