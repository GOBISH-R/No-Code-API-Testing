// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MessageComposer from './MessageComposer.jsx';
import MessageLog from './MessageLog.jsx';

afterEach(cleanup);

function type(value) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
}

describe('MessageComposer — sending', () => {
  it('sends the drafted message', () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} />);

    type('hello');
    fireEvent.click(screen.getByText('Send Message'));

    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('will not send an empty draft', () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} />);
    expect(screen.getByText('Send Message')).toBeDisabled();
  });

  it('keeps the draft after sending, since resending is the common rhythm', () => {
    render(<MessageComposer onSend={vi.fn()} />);
    type('ping');
    fireEvent.click(screen.getByText('Send Message'));
    expect(screen.getByRole('textbox').value).toBe('ping');
  });

  it('is disabled with an explanation when not connected', () => {
    render(<MessageComposer onSend={vi.fn()} disabled />);
    type('hello');
    expect(screen.getByText('Send Message')).toBeDisabled();
    expect(screen.getByText(/connect first/i)).toBeTruthy();
  });

  it('clears the draft on demand', () => {
    render(<MessageComposer onSend={vi.fn()} />);
    type('something');
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByRole('textbox').value).toBe('');
  });
});

describe('MessageComposer — JSON mode', () => {
  it('blocks sending invalid JSON in JSON mode', () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} />);

    fireEvent.click(screen.getByLabelText('JSON'));
    type('{broken');

    expect(screen.getByText('Invalid JSON')).toBeTruthy();
    expect(screen.getByText('Send Message')).toBeDisabled();
  });

  it('allows sending valid JSON', () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} />);

    fireEvent.click(screen.getByLabelText('JSON'));
    type('{"a":1}');
    fireEvent.click(screen.getByText('Send Message'));

    expect(onSend).toHaveBeenCalledWith('{"a":1}');
  });

  it('formats JSON on demand', () => {
    render(<MessageComposer onSend={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('JSON'));
    type('{"a":1}');
    fireEvent.click(screen.getByText('Format'));
    expect(screen.getByRole('textbox').value).toBe('{\n  "a": 1\n}');
  });

  it('does not treat plain text as invalid in Text mode', () => {
    render(<MessageComposer onSend={vi.fn()} />);
    type('{broken');
    expect(screen.queryByText('Invalid JSON')).toBeNull();
    expect(screen.getByText('Send Message')).not.toBeDisabled();
  });
});

describe('MessageComposer — placeholders', () => {
  it('shows a runtime value it can resolve', () => {
    render(<MessageComposer onSend={vi.fn()} runtimeVariables={{ uid: '42' }} />);
    type('{"id":"{{uid}}"}');
    expect(screen.getByText('{{uid}} → 42')).toBeTruthy();
  });

  it('lists an unknown placeholder without inventing a value', () => {
    // Global/environment variables are resolved server-side, so the browser must not
    // pretend to know them.
    render(<MessageComposer onSend={vi.fn()} runtimeVariables={{}} />);
    type('{"id":"{{serverSide}}"}');
    expect(screen.getByText('{{serverSide}}')).toBeTruthy();
  });
});

describe('MessageComposer — history', () => {
  it('reloads a previous message into the draft', () => {
    render(<MessageComposer onSend={vi.fn()} history={['{"action":"ping"}']} />);
    fireEvent.click(screen.getByText('{"action":"ping"}'));
    expect(screen.getByRole('textbox').value).toBe('{"action":"ping"}');
  });
});

describe('MessageLog', () => {
  const messages = [
    { id: '1', direction: 'system', type: 'text', payload: 'Connected', size: 9, timestamp: Date.now() },
    { id: '2', direction: 'sent', type: 'json', payload: '{"a":1}', size: 7, timestamp: Date.now() },
    { id: '3', direction: 'received', type: 'text', payload: 'pong', size: 4, timestamp: Date.now() },
  ];

  it('shows an empty state before anything happens', () => {
    render(<MessageLog messages={[]} />);
    expect(screen.getByText(/no messages yet/i)).toBeTruthy();
  });

  it('renders every message with its metadata', () => {
    const { container } = render(<MessageLog messages={messages} />);

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('pong')).toBeTruthy();

    // Scoped to the message rows: "Sent"/"Received" also name the filter buttons.
    const labels = [...container.querySelectorAll('.ws-message__direction')].map((n) => n.textContent);
    expect(labels).toEqual(['System', 'Sent', 'Received']);
  });

  it('pretty-prints JSON payloads', () => {
    const { container } = render(<MessageLog messages={messages} />);
    // Read textContent directly — getByText normalises the whitespace that is the
    // whole point of pretty-printing.
    const payloads = [...container.querySelectorAll('.ws-message__payload')].map((n) => n.textContent);
    expect(payloads).toContain('{\n  "a": 1\n}');
  });

  it('counts each direction', () => {
    render(<MessageLog messages={messages} />);
    expect(screen.getByText(/↑ 1 · ↓ 1/)).toBeTruthy();
  });

  it('filters by direction', () => {
    const { container } = render(<MessageLog messages={messages} />);

    // The filter button, not the message label of the same name.
    fireEvent.click(container.querySelector('.ws-log__filters').querySelectorAll('button')[2]);

    expect(screen.getByText('pong')).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
    expect(container.querySelectorAll('.ws-message')).toHaveLength(1);
  });

  it('searches payloads', () => {
    render(<MessageLog messages={messages} />);
    fireEvent.change(screen.getByPlaceholderText(/search messages/i), { target: { value: 'pong' } });
    expect(screen.getByText('pong')).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
  });

  it('explains when a filter matches nothing', () => {
    render(<MessageLog messages={messages} />);
    fireEvent.change(screen.getByPlaceholderText(/search messages/i), { target: { value: 'zzz' } });
    expect(screen.getByText(/no messages match/i)).toBeTruthy();
  });
});
