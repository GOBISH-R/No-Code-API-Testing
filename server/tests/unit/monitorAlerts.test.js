import { describe, it, expect } from 'vitest';
import { summariseFailures, postWebhook } from '../../src/services/monitors/monitorAlerts.js';

describe('summariseFailures', () => {
  it('names each request that did not pass, and why', () => {
    const run = {
      results: [
        { method: 'GET', requestName: 'Health', success: true, assertions: { allPassed: true, results: [] } },
        { method: 'POST', requestName: 'Login', success: false, error: 'Could not resolve the host.' },
        {
          method: 'GET',
          requestName: 'Profile',
          iterationLabel: 'email=ada@x.test',
          success: true,
          assertions: {
            allPassed: false,
            results: [
              { pass: true, label: 'Status Code', operator: 'equals', expected: '200', actual: 200 },
              { pass: false, label: 'JSON $.id', operator: 'exists', actual: undefined },
              { pass: false, label: 'JSON $.name', operator: 'equals', expected: 'Ada', actual: 'Bob' },
            ],
          },
        },
      ],
    };
    expect(summariseFailures(run)).toEqual([
      'POST Login — Could not resolve the host.',
      'GET Profile [email=ada@x.test] — JSON $.id exists, got nothing',
    ]);
  });

  it('keeps the list short', () => {
    const results = Array.from({ length: 8 }, (_, i) => ({ method: 'GET', requestName: `R${i}`, success: false, error: 'boom' }));
    const lines = summariseFailures({ results });
    expect(lines).toHaveLength(6);
    expect(lines.at(-1)).toBe('…and 3 more');
  });

  it('copes with no run at all', () => {
    expect(summariseFailures(null)).toEqual([]);
  });
});

describe('postWebhook', () => {
  // The webhook URL is typed by a user, so it must never reach the server's own network.
  it.each(['http://127.0.0.1:9/hook', 'http://localhost/hook', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/hook'])(
    'refuses %s',
    async (url) => {
      await expect(postWebhook(url, { text: 'x' })).rejects.toThrow(/not allowed|private|internal/i);
    },
  );
});
