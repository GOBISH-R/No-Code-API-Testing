// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useEscapeToClose } from './useEscapeToClose.js';

afterEach(cleanup);

function Window({ onClose, children }) {
  useEscapeToClose(onClose);
  return <div>{children}</div>;
}

const escape = () => fireEvent.keyDown(window, { key: 'Escape' });

describe('useEscapeToClose', () => {
  it('closes the window on Escape, and ignores other keys', () => {
    const onClose = vi.fn();
    render(<Window onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes only the window on top when one is open over another', () => {
    const under = vi.fn();
    const over = vi.fn();
    const { rerender } = render(<Window onClose={under} />);
    rerender(
      <Window onClose={under}>
        <Window onClose={over} />
      </Window>,
    );
    escape();
    expect(over).toHaveBeenCalledTimes(1);
    expect(under).not.toHaveBeenCalled();

    // Once the top one has gone, Escape reaches the one beneath.
    rerender(<Window onClose={under} />);
    escape();
    expect(under).toHaveBeenCalledTimes(1);
  });

  it('stops listening once every window is closed', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Window onClose={onClose} />);
    unmount();
    escape();
    expect(onClose).not.toHaveBeenCalled();
  });
});
