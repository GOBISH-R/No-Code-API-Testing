import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import WorkspacePreview from './WorkspacePreview.jsx';
import ThemeToggle from '../components/common/ThemeToggle.jsx';
import './landing.css';
import BrandMark from '../components/common/BrandMark.jsx';

/**
 * The product page.
 *
 * Short on purpose. The audience is a developer deciding whether to open the tool, and
 * that decision is made in the first screen — everything after it is either evidence
 * or padding. So: one claim, a look at the real thing, what it speaks, what it does.
 *
 * Exactly two links lead into the app: the persistent one in the nav and the one under
 * the headline. Repeating the same button down the page does not raise the odds of a
 * click, it just reads as a page that does not trust its own content.
 *
 * Everything claimed here is something the app does today. No logo wall, no testimonial,
 * no metrics — this product has no customers to cite, and inventing them is the fastest
 * way to lose a reader who checks.
 */

const PROTOCOLS = [
  { name: 'REST', tag: 'HTTP', body: 'Any method, with params, headers and four body modes.' },
  { name: 'GraphQL', tag: 'HTTP', body: 'Introspected schema, autocomplete, and queries checked before they are sent.' },
  { name: 'WebSocket', tag: 'Persistent', body: 'Scripted multi-step exchanges, including GraphQL subscriptions.' },
];

const FEATURES = [
  ['Assertions without code', 'Status, timing, headers or any JSONPath — built from dropdowns.'],
  ['Request chaining', 'Capture a token or id from one response, use it in the next.'],
  ['Data-driven runs', 'Attach a CSV or JSON file; the collection runs once per row.'],
  ['Environments', 'Point the same requests at local, staging or production.'],
  ['Mock endpoints', 'Serve a fixed response while the real service is still being built.'],
  ['Reports', 'Every run saved with its assertions and timings, printable to PDF.'],
];

export default function LandingPage() {
  useEffect(() => {
    document.title = 'ApIForge';
  }, []);

  return (
    <div className="landing">
      <header className="landing__nav">
        <span className="landing__brand">
          <BrandMark size={28} className="landing__logo" />
          <span className="landing__brand-name">ApIForge</span>
        </span>
        {/* Where Postman puts them: a quiet "Sign in" beside the one filled button. */}
        <div className="landing__nav-actions">
          <ThemeToggle className="landing__theme-toggle" />
          <Link className="landing__nav-link" to="/login">
            Sign in
          </Link>
          <Link className="landing__nav-cta" to="/signup">
            Get started
          </Link>
        </div>
      </header>

      <main>
        <section className="landing__hero">
          <p className="landing__eyebrow">Test &amp; validate</p>
          <h1 className="landing__title">
            API testing that reads like a <em>test</em>, not a script.
          </h1>
          <p className="landing__lede">
            Build a request, state what the response should be, and run it — on its own or
            as a collection against a file of test data. No scripting, no test files.
          </p>

          <div className="landing__actions">
            <Link className="landing__cta" to="/signup">
              Get started
            </Link>
            <span className="landing__actions-note">Nothing to install.</span>
          </div>

          <div className="landing__preview">
            <WorkspacePreview />
          </div>
        </section>

        <section className="landing__section">
          <div className="landing__protocols">
            {PROTOCOLS.map((p) => (
              <article key={p.name} className="landing__protocol">
                <header>
                  <h2>{p.name}</h2>
                  <span className="landing__protocol-tag">{p.tag}</span>
                </header>
                <p>{p.body}</p>
              </article>
            ))}
          </div>

          <ul className="landing__features">
            {FEATURES.map(([title, body]) => (
              <li key={title} className="landing__feature">
                <h2>{title}</h2>
                <p>{body}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="landing__footer">
        <span className="landing__footer-brand">
          <BrandMark size={18} />
          ApIForge
        </span>
        <nav className="landing__footer-links" aria-label="Legal">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </nav>
        <span className="landing__footer-note">REST · GraphQL · WebSocket</span>
      </footer>
    </div>
  );
}
