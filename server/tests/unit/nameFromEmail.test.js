import { describe, it, expect } from 'vitest';
import { nameFromEmail } from '../../src/services/accounts/accountService.js';

// Sign-up asks only for email and password; the display name comes from the address.
describe('nameFromEmail', () => {
  it.each([
    ['ada.lovelace@example.com', 'Ada Lovelace'],
    ['grace_hopper@example.com', 'Grace Hopper'],
    ['JOHN-DOE@corp.com', 'John Doe'],
    ['ada+work@example.com', 'Ada'],
    ['jsmith42@example.com', 'Jsmith'],
  ])('%s -> %s', (email, name) => {
    expect(nameFromEmail(email)).toBe(name);
  });

  it('falls back to the local part when nothing readable is left', () => {
    expect(nameFromEmail('12345@example.com')).toBe('12345');
  });
});
