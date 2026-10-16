// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from './LandingPage.jsx';

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe('LandingPage', () => {
  it('puts sign-in and sign-up where Postman does, and nowhere else', () => {
    // Nav: a quiet "Sign in" beside one filled "Get started" button. Hero: one sign-up
    // button. An earlier version repeated its call to action four times down the page;
    // the counts are asserted so that cannot creep back.
    const { container } = renderLanding();

    expect(container.querySelectorAll('a[href="/login"]')).toHaveLength(1);
    expect(container.querySelectorAll('a[href="/signup"]')).toHaveLength(2);
    expect(container.querySelectorAll('.landing__nav-cta')).toHaveLength(1);
    expect(container.querySelectorAll('.landing__cta')).toHaveLength(1);
  });

  it('gives every call to action a visible label', () => {
    // A blanket `.landing a` colour rule once outranked the button classes and painted
    // the CTAs accent-on-accent: solid rectangles with invisible text. jsdom does not
    // cascade stylesheets, so this guards the markup half — an empty button is the
    // other way to end up with a blank control.
    const { container } = renderLanding();

    const ctas = container.querySelectorAll('.landing__cta, .landing__nav-cta');
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) {
      expect(cta.textContent.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no dead in-page anchors', () => {
    // A nav link to #features with no #features is as broken as a dead URL, and is
    // exactly what happens when a section is renamed or removed.
    const { container } = renderLanding();

    for (const anchor of container.querySelectorAll('a[href^="#"]')) {
      const id = anchor.getAttribute('href').slice(1);
      expect(container.querySelector(`#${id}`), `no section with id "${id}"`).not.toBeNull();
    }
  });

  it('stays short enough to scan', () => {
    // The page is the pitch, not the manual. Section count is a cheap proxy for length,
    // and the previous version had five plus a four-step walkthrough.
    const { container } = renderLanding();
    expect(container.querySelectorAll('section').length).toBeLessThanOrEqual(2);
  });

  it('names all three protocols the app supports', () => {
    renderLanding();
    for (const protocol of ['REST', 'GraphQL', 'WebSocket']) {
      expect(screen.getAllByText(new RegExp(protocol)).length).toBeGreaterThan(0);
    }
  });

  it('has exactly one top-level heading', () => {
    renderLanding();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('hides the decorative product mockup from assistive technology', () => {
    // It repeats, as pixels, what the copy around it already says; announcing its
    // dozens of fragments ("GET", "201", "$.name") would be noise.
    const { container } = renderLanding();
    expect(container.querySelector('.preview')).toHaveAttribute('aria-hidden', 'true');
  });
});
