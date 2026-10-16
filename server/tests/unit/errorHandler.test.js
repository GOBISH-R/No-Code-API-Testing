import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';

function respond(err, statusCode = 500) {
  const res = {
    statusCode,
    status: vi.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(),
  };
  errorHandler(err, { method: 'GET', originalUrl: '/api/x' }, res, () => {});
  return res.json.mock.calls[0][0];
}

const ORIGINAL_ENV = process.env.NODE_ENV;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe('errorHandler in production', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  it('does not return the message of an unexpected server error', () => {
    // These come from whatever library failed, and can carry connection strings,
    // absolute paths or schema details.
    const body = respond(new Error('connect ECONNREFUSED mongodb://admin:hunter2@10.0.0.4:27017'));

    expect(body.message).toBe('Internal Server Error');
    expect(body.message).not.toMatch(/hunter2|10\.0\.0\.4/);
  });

  it('still returns a 4xx message, which is written for the user', () => {
    expect(respond(new Error('Invalid environment id.'), 400).message).toBe('Invalid environment id.');
    expect(respond(new Error('Collection not found.'), 404).message).toBe('Collection not found.');
  });

  it('never includes a stack trace', () => {
    expect(respond(new Error('boom'), 500)).not.toHaveProperty('stack');
    expect(respond(new Error('bad input'), 400)).not.toHaveProperty('stack');
  });

  it('always logs the real message server-side', () => {
    respond(new Error('the real cause'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('the real cause'));
  });
});

describe('errorHandler in development', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('keeps the real message so the cause is visible while working', () => {
    expect(respond(new Error('Cannot read properties of undefined')).message).toBe(
      'Cannot read properties of undefined',
    );
  });

  it('includes the stack', () => {
    expect(respond(new Error('boom'))).toHaveProperty('stack');
  });
});

describe('errorHandler status selection', () => {
  it('defaults to 500 when nothing set a status', () => {
    const res = {
      statusCode: 200,
      status: vi.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(),
    };
    errorHandler(new Error('x'), { method: 'GET', originalUrl: '/' }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('is still recognised by Express as error middleware', () => {
    // Express selects error middleware by arity; three parameters would silently make
    // this ordinary middleware that never runs.
    expect(errorHandler).toHaveLength(4);
  });
});

describe('errors from the body parser', () => {
  // These are raised before any route runs, so nothing has set res.status yet.
  const parserError = (type, status) => Object.assign(new Error('raw parser text'), { type, status });

  it.each(['production', 'development'])('keeps their 4xx status in %s, with a message a person can act on', (env) => {
    process.env.NODE_ENV = env;
    const bad = respond(parserError('entity.parse.failed', 400), 200);
    expect(bad.message).toBe('The request body is not valid JSON.');
    const big = respond(parserError('entity.too.large', 413), 200);
    expect(big.message).toMatch(/too large/);
  });

  it('reports the status itself, not 500', () => {
    const res = { statusCode: 200, status: vi.fn(function status(c) { this.statusCode = c; return this; }), json: vi.fn() };
    errorHandler(parserError('entity.too.large', 413), { method: 'POST', originalUrl: '/api/x' }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('never trusts a 5xx status carried by an error', () => {
    process.env.NODE_ENV = 'production';
    const body = respond(Object.assign(new Error('secret detail'), { status: 503 }), 200);
    expect(body.message).toBe('Internal Server Error');
  });
});
