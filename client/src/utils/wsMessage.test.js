import { describe, it, expect } from 'vitest';
import {
  isValidJson,
  formatJson,
  describePlaceholders,
  messageDirectionLabel,
  formatMessageTime,
  displayPayload,
} from './wsMessage.js';

describe('isValidJson', () => {
  it('accepts valid JSON and empty input', () => {
    expect(isValidJson('{"a":1}')).toBe(true);
    expect(isValidJson('')).toBe(true);
    expect(isValidJson('   ')).toBe(true);
  });

  it('rejects malformed JSON', () => {
    expect(isValidJson('{broken')).toBe(false);
  });
});

describe('formatJson', () => {
  it('pretty-prints valid JSON', () => {
    expect(formatJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('returns the text unchanged when it will not parse', () => {
    // Formatting must never destroy a half-typed message.
    expect(formatJson('{"a":')).toBe('{"a":');
    expect(formatJson('hello')).toBe('hello');
  });
});

describe('describePlaceholders', () => {
  it('finds placeholders and marks the ones it can resolve', () => {
    const found = describePlaceholders('{"id":"{{uid}}","x":"{{other}}"}', { uid: '42' });

    expect(found).toHaveLength(2);
    expect(found[0]).toEqual({ name: 'uid', known: true, value: '42' });
    expect(found[1]).toEqual({ name: 'other', known: false, value: undefined });
  });

  it('reports each placeholder once even when repeated', () => {
    expect(describePlaceholders('{{a}} {{a}} {{a}}', {})).toHaveLength(1);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(describePlaceholders('{{  spaced  }}', { spaced: 'v' })[0].known).toBe(true);
  });

  it('returns nothing for text with no placeholders', () => {
    expect(describePlaceholders('plain text', {})).toEqual([]);
    expect(describePlaceholders('', {})).toEqual([]);
    expect(describePlaceholders(undefined, {})).toEqual([]);
  });
});

describe('messageDirectionLabel', () => {
  it('labels each direction', () => {
    expect(messageDirectionLabel('sent')).toBe('Sent');
    expect(messageDirectionLabel('received')).toBe('Received');
    expect(messageDirectionLabel('system')).toBe('System');
  });
});

describe('formatMessageTime', () => {
  it('formats a timestamp as time of day', () => {
    expect(formatMessageTime(Date.UTC(2026, 0, 1, 12, 34, 56))).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('handles a missing timestamp', () => {
    expect(formatMessageTime(null)).toBe('');
  });
});

describe('displayPayload', () => {
  it('pretty-prints JSON messages', () => {
    expect(displayPayload({ type: 'json', payload: '{"a":1}' })).toBe('{\n  "a": 1\n}');
  });

  it('leaves text messages exactly as received', () => {
    expect(displayPayload({ type: 'text', payload: '  spaced  ' })).toBe('  spaced  ');
  });

  it('explains binary frames rather than showing nothing', () => {
    expect(displayPayload({ type: 'binary', payload: null })).toMatch(/binary frame/i);
  });

  it('handles a missing message', () => {
    expect(displayPayload(null)).toBe('');
  });
});
