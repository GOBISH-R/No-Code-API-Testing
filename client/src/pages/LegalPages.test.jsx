// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrivacyPage from './PrivacyPage.jsx';
import TermsPage from './TermsPage.jsx';

beforeAll(() => {
  window.scrollTo = vi.fn();
});
afterEach(cleanup);

const show = (page) => render(<MemoryRouter>{page}</MemoryRouter>);

describe('Privacy Policy', () => {
  it('says what is collected, how Google data is used, how to delete it, and who to contact', () => {
    show(<PrivacyPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy();
    for (const heading of ['What we collect', 'How we use Google sign-in data', 'Deleting your data', 'Contact']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: 'apiforgeo@gmail.com' }).getAttribute('href')).toBe('mailto:apiforgeo@gmail.com');
    expect(document.title).toBe('Privacy Policy — ApIForge');
  });
});

describe('Terms of Service', () => {
  it('sets out the rules and links to the other page', () => {
    show(<TermsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Using ApIForge fairly' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
  });
});
