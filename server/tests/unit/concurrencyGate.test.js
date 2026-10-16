import { describe, it, expect } from 'vitest';
import { createConcurrencyGate } from '../../src/utils/concurrencyGate.js';
import { TooBusyError } from '../../src/utils/errors.js';

describe('createConcurrencyGate', () => {
  it('caps each key independently', () => {
    const gate = createConcurrencyGate({ perKey: 2, total: 10 });
    gate.acquire('ada');
    gate.acquire('ada');
    expect(() => gate.acquire('ada')).toThrow(TooBusyError);
    // Ada being at her limit does not affect Grace.
    expect(() => gate.acquire('grace')).not.toThrow();
  });

  it('caps the total across all keys', () => {
    const gate = createConcurrencyGate({ perKey: 5, total: 3 });
    gate.acquire('a');
    gate.acquire('b');
    gate.acquire('c');
    expect(() => gate.acquire('d')).toThrow(/busy/i);
  });

  it('gives the slot back on release, and releasing twice does not over-credit', () => {
    const gate = createConcurrencyGate({ perKey: 1, total: 10 });
    const release = gate.acquire('ada');
    release();
    release();
    expect(gate.inUse('ada')).toBe(0);
    expect(gate.inUse()).toBe(0);
    gate.acquire('ada');
    expect(() => gate.acquire('ada')).toThrow(TooBusyError);
  });
});
