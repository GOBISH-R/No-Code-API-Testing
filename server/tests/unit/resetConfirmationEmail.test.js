import { describe, it, expect } from 'vitest';
import { describeDevice, formatRequestTime } from '../../src/services/accounts/deviceLabel.js';
import { renderActionEmail } from '../../src/services/accounts/emailTemplate.js';

describe('describeDevice', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari on macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1', 'Chrome on iOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', 'Chrome on Android'],
  ])('%s', (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });

  it('falls back to a neutral description', () => {
    expect(describeDevice('')).toBe('an unknown browser');
    expect(describeDevice(undefined)).toBe('an unknown browser');
    expect(describeDevice('curl/8.4.0')).toBe('an unknown browser');
  });
});

describe('formatRequestTime', () => {
  it('is spelled out in UTC, since the email cannot know the reader’s time zone', () => {
    expect(formatRequestTime(new Date('2026-10-15T10:42:00Z'))).toBe('15 Oct 2026, 10:42 UTC');
  });
});

describe('the two-button email', () => {
  const base = {
    heading: 'Is this you?',
    greeting: 'Hi Ada,',
    intro: 'Someone is trying to reset the password.',
    buttonLabel: "Yes, it's me",
    link: 'https://app.test/reset-confirm?token=abc&answer=yes',
    note: 'note',
  };

  it('shows both buttons, escaped, and leaves out the paste-this-link line', () => {
    const html = renderActionEmail({
      ...base,
      secondary: { label: "No, it wasn't me", link: 'https://app.test/reset-confirm?token=abc&answer=no' },
    });
    expect(html).toContain('Yes, it&#39;s me');
    expect(html).toContain('No, it wasn&#39;t me');
    expect(html).toContain('answer=no');
    expect(html).not.toContain('Or paste this link');
  });

  it('keeps the paste-this-link line for a one-button email', () => {
    expect(renderActionEmail(base)).toContain('Or paste this link');
  });
});
