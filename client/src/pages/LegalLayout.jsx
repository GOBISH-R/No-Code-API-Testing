import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from '../components/common/BrandMark.jsx';
import ThemeToggle from '../components/common/ThemeToggle.jsx';
import { LAST_UPDATED } from './legalInfo.js';
import './legal.css';

/** The frame shared by the Privacy Policy and Terms of Service pages. */
export default function LegalLayout({ title, children }) {
  useEffect(() => {
    document.title = `${title} — ApIForge`;
    window.scrollTo(0, 0);
  }, [title]);

  return (
    <div className="legal">
      <header className="legal__nav">
        <Link className="legal__brand" to="/">
          <BrandMark size={22} />
          ApIForge
        </Link>
        <ThemeToggle className="legal__theme" />
      </header>

      <main className="legal__main">
        <h1 className="legal__title">{title}</h1>
        <p className="legal__updated">Last updated: {LAST_UPDATED}</p>
        {children}
      </main>

      <footer className="legal__footer">
        <Link to="/">Home</Link>
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/terms">Terms of Service</Link>
      </footer>
    </div>
  );
}
