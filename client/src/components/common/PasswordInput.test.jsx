// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PasswordInput from './PasswordInput.jsx';

afterEach(cleanup);

describe('PasswordInput', () => {
  it('starts hidden and toggles between hidden and shown', () => {
    render(<PasswordInput aria-label="Password" defaultValue="hunter22" />);
    const input = screen.getByLabelText('Password');
    expect(input.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
    expect(input.value).toBe('hunter22');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input.type).toBe('password');
  });

  it('never submits the form it sits in', () => {
    let submitted = false;
    render(
      <form onSubmit={(e) => { e.preventDefault(); submitted = true; }}>
        <PasswordInput aria-label="Password" />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(submitted).toBe(false);
  });
});
