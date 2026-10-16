import { useEffect, useState } from 'react';
import Header from './components/layout/Header.jsx';
import Sidebar from './components/layout/Sidebar.jsx';
import RequestBuilder from './components/request/RequestBuilder.jsx';
import RunSetupModal from './components/runner/RunSetupModal.jsx';
import ExportWarningModal from './components/collections/ExportWarningModal.jsx';
import RuntimeContextPanel from './components/runtime/RuntimeContextPanel.jsx';
import { useCollections } from './hooks/useCollections.js';
import { useEnvironments } from './hooks/useEnvironments.js';
import { useGlobals } from './hooks/useGlobals.js';
import { useMocks } from './hooks/useMocks.js';
import { useRuntimeContext } from './hooks/useRuntimeContext.js';
import { useCollectionRunner } from './hooks/useCollectionRunner.js';
import { useTestRuns } from './hooks/useTestRuns.js';
import { useDashboard } from './hooks/useDashboard.js';
import { useImportExport } from './hooks/useImportExport.js';
import { useHistory } from './hooks/useHistory.js';
import { useMonitors } from './hooks/useMonitors.js';
import { useWorkspaces } from './hooks/useWorkspaces.js';
import { useEscapeToClose } from './hooks/useEscapeToClose.js';
import './App.css';

/**
 * On a phone the sidebar is a drawer over the workbench; this is the dimmed backdrop
 * behind it. Tapping it — or pressing Escape — closes the drawer.
 */
function SidebarBackdrop({ onClose }) {
  useEscapeToClose(onClose);
  return <div className="app-drawer__backdrop" onClick={onClose} aria-hidden="true" />;
}

/**
 * The workbench for one workspace — personal or a team's. Rendered with the workspace id
 * as its key, so switching workspace remounts it: every list is fetched again for the
 * new workspace, and nothing from the previous one (an open request, a selected
 * environment) can leak across.
 */
function Workbench({ workspacesState }) {
  const [selectedRequest, setSelectedRequest] = useState(null);
  // A request reopened from history: loaded into the builder as new and unsaved.
  // `key` changes on every open, so opening the same entry twice reloads it.
  const [draft, setDraft] = useState(null);
  // Deleting a collection or folder takes its requests with it. If the open request was
  // one of them, close it — otherwise the builder keeps offering to save a request that
  // no longer exists.
  const collectionsState = useCollections({
    onRemoved: (remainingIds) =>
      setSelectedRequest((open) => (open && !remainingIds.has(String(open._id)) ? null : open)),
  });
  const environmentsState = useEnvironments();
  const globalsState = useGlobals();
  const mocksState = useMocks();
  const runtimeContext = useRuntimeContext();
  const runnerState = useCollectionRunner();
  const testRunsState = useTestRuns();
  const dashboardState = useDashboard();
  const historyState = useHistory();
  const monitorsState = useMonitors();
  // An import creates a collection, so the sidebar has to pick it up.
  const importExportState = useImportExport({ onImported: () => collectionsState.refresh() });
  // Which collection the run-setup dialog is configuring, if any.
  const [runSetupId, setRunSetupId] = useState(null);
  const [showRuntime, setShowRuntime] = useState(false);
  // Phones only: whether the sidebar drawer is open. On a wider screen the sidebar is
  // always shown and this has no effect.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const runSetupCollection = collectionsState.collections.find((c) => c._id === runSetupId) || null;
  const runtimeVariableCount = Object.keys(runtimeContext.variables || {}).length;

  const handleStartRun = async (collectionId, dataset) => {
    setRunSetupId(null);
    await runnerState.run(collectionId, environmentsState.selectedId, dataset);
  };

  const handleSaved = (savedDoc) => {
    setDraft(null);
    setSelectedRequest(savedDoc);
    collectionsState.refresh();
  };

  const selectRequest = (request) => {
    setSidebarOpen(false);
    setDraft(null);
    setSelectedRequest(request);
  };

  // Throws on failure so the history panel can say so next to the list.
  const openHistoryEntry = async (id) => {
    const entry = await historyState.load(id);
    setSidebarOpen(false);
    setSelectedRequest(null);
    setDraft({ key: `${id}:${Date.now()}`, id, config: entry });
  };

  return (
    <div className="app-shell">
      <Header
        environmentsState={environmentsState}
        workspacesState={workspacesState}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />
      {workspacesState.role === 'viewer' && (
        <div className="viewer-banner" role="status">
          You are a <strong>viewer</strong> in “{workspacesState.current?.name}”: you can open, send and run
          requests, but not change anything here.
        </div>
      )}

      <div className="app-body">
        {sidebarOpen && <SidebarBackdrop onClose={() => setSidebarOpen(false)} />}
        <div className={`app-drawer${sidebarOpen ? ' app-drawer--open' : ''}`}>
        <Sidebar
          collectionsState={collectionsState}
          selectedRequestId={selectedRequest?._id}
          onSelectRequest={selectRequest}
          onNewRequest={() => selectRequest(null)}
          runnerState={runnerState}
          onRunCollection={setRunSetupId}
          importExportState={importExportState}
          globalsState={globalsState}
          mocksState={mocksState}
          testRunsState={testRunsState}
          dashboardState={dashboardState}
          historyState={historyState}
          monitorsState={monitorsState}
          environments={environmentsState.environments}
          activeHistoryId={draft?.id}
          readOnly={workspacesState.role === 'viewer'}
          onOpenHistory={openHistoryEntry}
          workspacesState={workspacesState}
        />
        </div>
        <main className="app-main">
          <RequestBuilder
            savedRequest={selectedRequest}
            onSaved={handleSaved}
            collections={collectionsState.collections}
            environmentId={environmentsState.selectedId}
            runtimeVariables={runtimeContext.variables}
            onCaptured={runtimeContext.merge}
            draft={draft}
            readOnly={workspacesState.role === 'viewer'}
            onSent={historyState.refresh}
          />
        </main>
      </div>

      {/* Runtime variables are reference material, not a step in the task — they belong
          in a drawer you open when a chained value looks wrong, not in a panel that
          pushes the request builder down the page. */}
      <footer className="app-footer">
        <div className="app-footer__bar">
          <button
            type="button"
            className="app-footer__toggle"
            onClick={() => setShowRuntime((open) => !open)}
            aria-expanded={showRuntime}
          >
            <span className="app-footer__caret">{showRuntime ? '▼' : '▲'}</span>
            Runtime variables
            <span className="app-footer__count">{runtimeVariableCount}</span>
          </button>
        </div>
        {showRuntime && (
          <div className="app-footer__body">
            <RuntimeContextPanel runtimeContext={runtimeContext} />
          </div>
        )}
      </footer>

      {/* Rendered only while open, so closing it unmounts the dialog and discards the
          chosen data file. Kept mounted, its state would survive: the next run — of any
          collection — would silently reuse the previous run's dataset. */}
      <ExportWarningModal
        pendingExport={importExportState.pendingExport}
        onConfirm={importExportState.confirmExport}
        onCancel={importExportState.cancelExport}
      />

      {runSetupCollection && (
        <RunSetupModal
          collection={runSetupCollection}
          environmentName={environmentsState.selected?.name}
          isRunning={Boolean(runnerState.runningId)}
          onRun={handleStartRun}
          onClose={() => setRunSetupId(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  useEffect(() => {
    document.title = 'Workspace — ApIForge';
  }, []);

  const workspacesState = useWorkspaces();
  if (!workspacesState.ready) return <div className="app-loading">Loading the workspace…</div>;
  return <Workbench key={workspacesState.currentId ?? 'personal'} workspacesState={workspacesState} />;
}
