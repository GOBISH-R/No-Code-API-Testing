import { describe, it, expect } from 'vitest';
import { renderActionEmail, escapeHtml, APP_NAME } from '../../src/services/accounts/emailTemplate.js';

const base = {
  heading: 'Verify your email address',
  greeting: 'Hi Ada,',
  intro: 'Please confirm this address.',
  buttonLabel: 'Verify my email',
  link: 'https://apiforge.example/verify-email?token=abc&x=1',
  note: 'This link expires in 10 minutes.',
};

describe('renderActionEmail', () => {
  it('has the brand, heading, button and the link spelled out', () => {
    const html = renderActionEmail(base);
    expect(html).toContain(APP_NAME);
    expect(html).toContain('Verify your email address');
    expect(html).toContain('>Verify my email</a>');
    expect(html).toContain('Or paste this link into your browser');
    // The link appears as the button target and as visible text, with & escaped.
    expect(html.match(/verify-email\?token=abc&amp;x=1/g)).toHaveLength(3);
    expect(html).toContain('All rights reserved');
  });

  it('escapes a name typed at sign-up, so it can never become markup in an inbox', () => {
    const html = renderActionEmail({ ...base, greeting: 'Hi <img src=x onerror=alert(1)>,' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Hi &lt;img src=x onerror=alert(1)&gt;,');
  });

  it('cannot be broken out of by a quote in the link', () => {
    const html = renderActionEmail({ ...base, link: 'https://a.example/"><script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('the logo', () => {
  it('is an image from the site when a URL is given, with an empty alt beside the name', () => {
    const html = renderActionEmail({ ...base, logoUrl: 'https://apiforge.example/brand/apiforge-mark.png' });
    expect(html).toContain('<img src="https://apiforge.example/brand/apiforge-mark.png" width="40" height="40" alt=""');
    expect(html).not.toContain('>API<');
  });

  it('is left out, rather than broken, when there is no URL', () => {
    expect(renderActionEmail(base)).not.toContain('<img');
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
