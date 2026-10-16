import { useEffect, useRef, useState } from 'react';
import TabBar from '../common/TabBar.jsx';
import KeyValueEditor from '../common/KeyValueEditor.jsx';
import AuthEditor from '../request/AuthEditor.jsx';
import ConnectionStatusBar from './ConnectionStatusBar.jsx';
import MessageComposer from './MessageComposer.jsx';
import MessageLog from './MessageLog.jsx';
import StepsEditor from './StepsEditor.jsx';
import { useWebSocketConnection } from '../../hooks/useWebSocketConnection.js';
import './websocket.css';

function activeCount(rows) {
  return rows.filter((r) => r.enabled && r.key.trim()).length;
}

/**
 * The WebSocket workspace.
 *
 * Deliberately not the REST builder with different labels: there is no Send button
 * that produces one response, no status code, and no request/response split. The
 * layout is connection-first — configure, connect, then hold a conversation — because
 * that is what the protocol actually is.
 */
export default function WebSocketWorkspace({
  requestId,
  request,
  setUrl,
  params,
  headers,
  auth,
  websocket,
  environmentId,
  runtimeVariables,
  onSave,
  saveLabel,
  isSaving,
}) {
  const [activeTab, setActiveTab] = useState('params');
  const connectionState = useWebSocketConnection();
  const { gatewayState, connection, messages, error, isOpen, isBusy, sentHistory } = connectionState;

  /**
   * Loading a different saved request must not inherit the previous one's connection.
   *
   * This component stays mounted across that switch, so without this the status bar
   * would keep claiming "Connected" while the URL bar showed somewhere else entirely,
   * and the message log would show another request's conversation.
   */
  const { reset } = connectionState;
  const loadedIdRef = useRef(requestId);
  useEffect(() => {
    const previous = loadedIdRef.current;
    loadedIdRef.current = requestId;
    // null -> id is this same draft being saved for the first time, not a switch;
    // dropping a working connection there would be gratuitous.
    if (previous === null || previous === requestId) return;
    reset();
  }, [requestId, reset]);

  const handleConnect = () => {
    connectionState.connect({
      url: request.url,
      params: params.rows,
      headers: headers.rows,
      auth: auth.value,
      subprotocols: websocket.value.subprotocols
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      reconnect: websocket.value.reconnect,
      heartbeat: websocket.value.heartbeat,
      environmentId,
      runtimeVariables,
    });
  };

  const tabs = [
    { id: 'params', label: 'Query', count: activeCount(params.rows) },
    { id: 'headers', label: 'Headers', count: activeCount(headers.rows) },
    { id: 'auth', label: 'Auth', count: auth.value.type !== 'none' ? 1 : 0 },
    {
      id: 'connection',
      label: 'Connection',
      count: websocket.value.subprotocols.trim() ? 1 : 0,
    },
    { id: 'subscription', label: 'GraphQL', count: websocket.value.graphql?.enabled ? 1 : 0 },
    { id: 'steps', label: 'Steps', count: (websocket.value.steps || []).length },
  ];

  const subscription = websocket.value.graphql || {};
  const setSubscription = (patch) =>
    websocket.set({ graphql: { ...subscription, ...patch } });

  return (
    <div className="ws-workspace">
      <div className="ws-workspace__bar">
        <span className="ws-workspace__scheme">WS</span>
        <input
          className="ws-workspace__url"
          type="text"
          placeholder="wss://example.com/socket"
          value={request.url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
        />

        {!isOpen ? (
          <button
            type="button"
            className="ws-workspace__connect"
            onClick={handleConnect}
            disabled={isBusy || !request.url.trim()}
          >
            {isBusy ? 'Connecting…' : 'Connect'}
          </button>
        ) : (
          <>
            <button type="button" className="ws-workspace__reconnect" onClick={connectionState.reconnect}>
              Reconnect
            </button>
            <button type="button" className="ws-workspace__disconnect" onClick={connectionState.disconnect}>
              Disconnect
            </button>
          </>
        )}

        {onSave && (
          <button
            type="button"
            className="ws-workspace__reconnect"
            onClick={onSave}
            disabled={isSaving}
            title="Save this connection and its steps into a collection"
          >
            {isSaving ? 'Saving…' : saveLabel}
          </button>
        )}
      </div>

      <ConnectionStatusBar
        gatewayState={gatewayState}
        connection={connection}
        messages={messages}
        error={error}
      />

      <div className="ws-workspace__config">
        <TabBar tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

        <div className="ws-workspace__config-body">
          {activeTab === 'params' && (
            <>
              <p className="ws-workspace__hint">
                Query parameters are appended to the handshake URL — a WebSocket has no separate
                parameter channel.
              </p>
              <KeyValueEditor
                rows={params.rows}
                onAddRow={params.addRow}
                onUpdateRow={params.updateRow}
                onRemoveRow={params.removeRow}
                addLabel="Add Param"
              />
            </>
          )}

          {activeTab === 'headers' && (
            <>
              <p className="ws-workspace__hint">
                Sent on the handshake. The browser cannot set these itself — they are applied by the
                server-side gateway.
              </p>
              <KeyValueEditor
                rows={headers.rows}
                onAddRow={headers.addRow}
                onUpdateRow={headers.updateRow}
                onRemoveRow={headers.removeRow}
                addLabel="Add Header"
              />
            </>
          )}

          {activeTab === 'auth' && <AuthEditor auth={auth} />}

          {activeTab === 'connection' && (
            <div className="ws-settings">
              <label className="ws-settings__field">
                Subprotocols <span className="auth-editor__optional">(comma separated)</span>
                <input
                  type="text"
                  placeholder="graphql-ws, json"
                  value={websocket.value.subprotocols}
                  onChange={(e) => websocket.set({ subprotocols: e.target.value })}
                />
              </label>

              <label className="ws-settings__toggle">
                <input
                  type="checkbox"
                  checked={websocket.value.reconnect.enabled}
                  onChange={(e) =>
                    websocket.set({
                      reconnect: { ...websocket.value.reconnect, enabled: e.target.checked },
                    })
                  }
                />
                Reconnect automatically if the connection drops
              </label>

              {websocket.value.reconnect.enabled && (
                <div className="ws-settings__row">
                  <label className="ws-settings__field ws-settings__field--small">
                    Max retries
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={websocket.value.reconnect.maxRetries}
                      onChange={(e) =>
                        websocket.set({
                          reconnect: { ...websocket.value.reconnect, maxRetries: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label className="ws-settings__field ws-settings__field--small">
                    Delay (ms)
                    <input
                      type="number"
                      min="100"
                      step="100"
                      value={websocket.value.reconnect.delayMs}
                      onChange={(e) =>
                        websocket.set({
                          reconnect: { ...websocket.value.reconnect, delayMs: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                </div>
              )}

              <label className="ws-settings__toggle">
                <input
                  type="checkbox"
                  checked={websocket.value.heartbeat.enabled}
                  onChange={(e) =>
                    websocket.set({
                      heartbeat: { ...websocket.value.heartbeat, enabled: e.target.checked },
                    })
                  }
                />
                Send heartbeat pings to detect a dead connection
              </label>

              <p className="ws-workspace__hint">
                Heartbeats use WebSocket ping/pong frames, so they never appear as messages to the
                server you are testing.
              </p>
            </div>
          )}

          {activeTab === 'subscription' && (
            <div className="ws-settings">
              <label className="ws-settings__toggle">
                <input
                  type="checkbox"
                  checked={Boolean(subscription.enabled)}
                  onChange={(e) => setSubscription({ enabled: e.target.checked })}
                />
                Run a GraphQL subscription over this connection
              </label>

              <p className="ws-workspace__hint">
                Subscriptions are the one GraphQL operation that needs a persistent connection —
                queries and mutations stay on HTTP under the GraphQL protocol. Enabling this
                negotiates the <code>graphql-ws</code> subprotocol and performs its
                connection_init / subscribe handshake for you; each pushed update then arrives as a
                message your Steps can wait on and assert against.
              </p>

              {subscription.enabled && (
                <>
                  <label className="ws-settings__field ws-settings__field--wide">
                    Subscription
                    <textarea
                      rows={5}
                      spellCheck={false}
                      placeholder={'subscription OnTick {\n  tick {\n    value\n  }\n}'}
                      value={subscription.query}
                      onChange={(e) => setSubscription({ query: e.target.value })}
                    />
                  </label>

                  <label className="ws-settings__field ws-settings__field--wide">
                    Variables <span className="auth-editor__optional">(JSON, optional)</span>
                    <textarea
                      rows={3}
                      spellCheck={false}
                      placeholder={'{\n  "room": "lobby"\n}'}
                      value={subscription.variables}
                      onChange={(e) => setSubscription({ variables: e.target.value })}
                    />
                  </label>

                  <label className="ws-settings__field">
                    Operation name <span className="auth-editor__optional">(optional)</span>
                    <input
                      type="text"
                      placeholder="OnTick"
                      value={subscription.operationName}
                      onChange={(e) => setSubscription({ operationName: e.target.value })}
                    />
                  </label>
                </>
              )}
            </div>
          )}

          {activeTab === 'steps' && <StepsEditor websocket={websocket} />}
        </div>
      </div>

      <div className="ws-workspace__conversation">
        <MessageComposer
          onSend={(payload) => connectionState.sendMessage(payload, { environmentId, runtimeVariables })}
          disabled={!isOpen}
          runtimeVariables={runtimeVariables}
          history={sentHistory}
        />
        <MessageLog messages={messages} onClear={connectionState.clearMessages} />
      </div>
    </div>
  );
}
