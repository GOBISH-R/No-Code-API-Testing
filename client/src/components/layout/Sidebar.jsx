import { useState } from 'react';
import CollectionsPanel from '../collections/CollectionsPanel.jsx';
import RunResultsModal from '../runner/RunResultsModal.jsx';
import GlobalsManagerModal from '../variables/GlobalsManagerModal.jsx';
import MocksManagerModal from '../mocks/MocksManagerModal.jsx';
import TestHistoryModal from '../runner/TestHistoryModal.jsx';
import DashboardModal from '../runner/DashboardModal.jsx';
import HistoryPanel from '../history/HistoryPanel.jsx';
import MonitorsModal from '../monitors/MonitorsModal.jsx';
import CopyCollectionModal from '../collections/CopyCollectionModal.jsx';
import './sidebar.css';

/**
 * The sidebar: the collection tree, and the way into everything that is not a request.
 *
 * The tools at the bottom (globals, mocks, history, dashboard) were previously buttons
 * in the topbar. They belong with navigation, not with the title — and putting them in
 * a fixed rail means the tree above them can take all the remaining height.
 */
export default function Sidebar({
  collectionsState,
  selectedRequestId,
  onSelectRequest,
  onNewRequest,
  runnerState,
  onRunCollection,
  importExportState,
  globalsState,
  mocksState,
  testRunsState,
  dashboardState,
  historyState,
  monitorsState,
  environments,
  activeHistoryId,
  onOpenHistory,
  readOnly = false,
  workspacesState,
}) {
  const [openTool, setOpenTool] = useState(null);
  // The collection being copied or moved to another workspace, if any.
  const [copying, setCopying] = useState(null);
  // Collections and History share the panel, as they do in Postman.
  const [view, setView] = useState('collections');

  // History and Dashboard both drill into a run through the same testRunsState, so
  // opening one closes the other rather than stacking two result modals on one
  // selection. Holding a single id instead of four booleans makes that structural.
  const close = () => setOpenTool(null);

  const tools = [
    {
      id: 'globals',
      label: 'Globals',
      title: globalsState.status === 'error'
        ? 'Globals require a database connection'
        : 'Variables available to every request',
      disabled: globalsState.status === 'error',
    },
    {
      id: 'mocks',
      label: 'Mocks',
      title: mocksState.status === 'error'
        ? 'Mocks require a database connection'
        : 'Fake endpoints served at /mock',
      disabled: mocksState.status === 'error',
    },
    { id: 'runs', label: 'Runs', title: 'Past collection runs' },
    { id: 'monitors', label: 'Monitors', title: 'Run collections automatically on a schedule' },
    { id: 'dashboard', label: 'Dashboard', title: 'Stats across collection runs' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__views" role="tablist" aria-label="Sidebar">
          {[
            { id: 'collections', label: 'Collections' },
            { id: 'history', label: 'History' },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={`sidebar__view ${view === v.id ? 'sidebar__view--active' : ''}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="sidebar__new"
          onClick={onNewRequest}
          title="Start a new, unsaved request"
        >
          New
        </button>
      </div>

      <div className="sidebar__scroll">
        {view === 'collections' ? (
          <CollectionsPanel
            collectionsState={collectionsState}
            selectedRequestId={selectedRequestId}
            onSelectRequest={onSelectRequest}
            onRun={onRunCollection}
            runningCollectionId={runnerState.runningId}
            importExportState={importExportState}
            readOnly={readOnly}
            onCopy={setCopying}
          />
        ) : (
          <HistoryPanel historyState={historyState} activeId={activeHistoryId} onOpen={onOpenHistory} />
        )}
        {runnerState.error && <p className="sidebar__error">{runnerState.error}</p>}
      </div>

      <nav className="sidebar__tools">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="sidebar__tool"
            onClick={() => setOpenTool(tool.id)}
            disabled={tool.disabled}
            title={tool.title}
          >
            {tool.label}
          </button>
        ))}
      </nav>

      {openTool === 'globals' && <GlobalsManagerModal globalsState={globalsState} onClose={close} />}
      {openTool === 'mocks' && <MocksManagerModal mocksState={mocksState} onClose={close} />}
      {openTool === 'runs' && (
        <TestHistoryModal
          testRunsState={testRunsState}
          collections={collectionsState.collections}
          onClose={close}
        />
      )}
      {copying && (
        <CopyCollectionModal
          collection={copying}
          workspacesState={workspacesState}
          onDone={() => collectionsState.refresh()}
          onClose={() => setCopying(null)}
        />
      )}
      {openTool === 'monitors' && (
        <MonitorsModal
          monitorsState={monitorsState}
          collections={collectionsState.collections}
          environments={environments}
          testRunsState={testRunsState}
          onClose={close}
          readOnly={readOnly}
        />
      )}
      {openTool === 'dashboard' && (
        <DashboardModal
          dashboardState={dashboardState}
          testRunsState={testRunsState}
          collections={collectionsState.collections}
          onClose={close}
        />
      )}

      {runnerState.result && (
        <RunResultsModal run={runnerState.result} onClose={runnerState.clearResult} />
      )}
    </aside>
  );
}
