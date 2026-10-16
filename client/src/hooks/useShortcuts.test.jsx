// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useShortcuts } from './useShortcuts.js';

function Harness(props) {
  useShortcuts(props);
  return null;
}

const press = (key, mods = { ctrlKey: true }) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
  document.body.dispatchEvent(event);
  return event;
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('useShortcuts', () => {
  it('sends on Ctrl+Enter and saves on Ctrl+S, suppressing the browser default', () => {
    const onSend = vi.fn();
    const onSave = vi.fn();
    render(<Harness onSend={onSend} onSave={onSave} />);

    press('Enter');
    const save = press('s');

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(save.defaultPrevented).toBe(true);
  });

  it('accepts ⌘ on a Mac', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    press('Enter', { metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('ignores plain keys', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    press('Enter', {});
    expect(onSend).not.toHaveBeenCalled();
  });

  it('stays out of the way while a dialog is open', () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    press('s');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does nothing for a handler that is currently unavailable', () => {
    render(<Harness onSend={null} />);
    expect(press('Enter').defaultPrevented).toBe(false);
  });
});
