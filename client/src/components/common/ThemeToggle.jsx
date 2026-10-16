import Icon from './Icon.jsx';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * The light/dark switch. One component so the landing page and the workspace offer
 * exactly the same control, backed by the same saved preference.
 */
export default function ThemeToggle({ className = 'topbar__icon-btn' }) {
  const theme = useTheme();
  const label = theme.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button type="button" className={className} onClick={theme.toggle} title={label} aria-label={label}>
      <Icon name={theme.theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
