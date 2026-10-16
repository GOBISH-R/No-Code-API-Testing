import { Link } from 'react-router-dom';
import ConnectionStatus from './ConnectionStatus.jsx';
import EnvironmentSelector from '../environments/EnvironmentSelector.jsx';
import ThemeToggle from '../common/ThemeToggle.jsx';
import AccountMenu from './AccountMenu.jsx';
import WorkspaceSwitcher from '../workspaces/WorkspaceSwitcher.jsx';
import './layout.css';
import BrandMark from '../common/BrandMark.jsx';
import Icon from '../common/Icon.jsx';

/**
 * The topbar.
 *
 * Deliberately thin. It used to carry Globals, Mocks, History and Dashboard as a row
 * of buttons, which made the most prominent strip of the app a menu of things you
 * rarely open. Those moved to the sidebar, where the rest of the navigation lives;
 * what stays here is what you change mid-task — the environment — plus status.
 */
export default function Header({ environmentsState, workspacesState, sidebarOpen = false, onToggleSidebar }) {
  return (
    <header className="topbar">
      {/* Phones only (hidden by CSS on wider screens): opens the sidebar drawer. */}
      <button
        type="button"
        className="topbar__icon-btn topbar__menu"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? 'Close the sidebar' : 'Open collections, history and tools'}
        aria-expanded={sidebarOpen}
      >
        <Icon name={sidebarOpen ? 'close' : 'menu'} size={18} />
      </button>
      <Link className="topbar__brand" to="/" title="Back to the home page">
        <BrandMark size={24} className="topbar__logo" />
        <span className="topbar__name">ApIForge</span>
      </Link>

      <WorkspaceSwitcher workspacesState={workspacesState} />

      <div className="topbar__spacer" />

      <div className="topbar__right">
        <EnvironmentSelector environmentsState={environmentsState} />
        <ThemeToggle />
        <ConnectionStatus />
        <AccountMenu />
      </div>
    </header>
  );
}
