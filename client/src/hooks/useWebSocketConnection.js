import { useCallback, useEffect, useRef, useState } from 'react';
import { apiOrigin, currentWorkspace } from '../services/api.js';

// The browser talks to our own gateway, never directly to the target: a browser
// cannot set handshake headers, and routing through the backend is what keeps the
// SSRF guard and server-side authentication in play.
const GATEWAY_URL = `${apiOrigin.replace(/^http/, 'ws')}/ws-gateway`;

const GATEWAY_STATES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  OPEN: 'open',
  CLOSED: 'closed',
  ERROR: 'error',
};

/**
 * Owns the browser end of the WebSocket gateway.
 *
 * Unlike an HTTP request there is no single call that returns a result: this holds a
 * live connection, an append-only message log, and the connection's current state,
 * all of which change on their own as the server sends things.
 */
export function useWebSocketConnection() {
  const gatewayRef = useRef(null);
  // Held in a ref as well as state so callbacks always see the current id without
  // being recreated on every change.
  const connectionIdRef = useRef(null);

  const [gatewayState, setGatewayState] = useState(GATEWAY_STATES.IDLE);
  const [connection, setConnection] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const [sentHistory, setSentHistory] = useState([]);

  const appendMessage = useCallback((message) => {
    setMessages((current) => [...current, message]);
  }, []);

  const closeGateway = useCallback(() => {
    const socket = gatewayRef.current;
    gatewayRef.current = null;
    connectionIdRef.current = null;
    try {
      socket?.close();
    } catch {
      // Already gone.
    }
  }, []);

  // A live socket must not outlive the component that owns it.
  useEffect(() => () => closeGateway(), [closeGateway]);

  const openGateway = useCallback(
    (onReady) =>
      new Promise((resolve, reject) => {
        if (gatewayRef.current?.readyState === WebSocket.OPEN) {
          onReady?.(gatewayRef.current);
          resolve(gatewayRef.current);
          return;
        }

        const socket = new WebSocket(GATEWAY_URL);
        gatewayRef.current = socket;

        socket.onmessage = (event) => {
          let payload;
          try {
            payload = JSON.parse(event.data);
          } catch {
            return;
          }

          switch (payload.type) {
            case 'ready':
              onReady?.(socket);
              resolve(socket);
              break;
            case 'connecting':
              connectionIdRef.current = payload.connectionId;
              setGatewayState(GATEWAY_STATES.CONNECTING);
              break;
            case 'open':
              setGatewayState(GATEWAY_STATES.OPEN);
              setConnection((c) => ({
                ...(c || {}),
                id: payload.connectionId,
                protocol: payload.protocol,
                state: 'open',
                openedAt: Date.now(),
              }));
              setError('');
              break;
            case 'message':
              appendMessage(payload.message);
              break;
            case 'closed':
              setGatewayState(GATEWAY_STATES.CLOSED);
              setConnection((c) => (c ? { ...c, state: 'closed', closeCode: payload.code } : c));
              break;
            case 'status':
              setConnection((c) => ({ ...(c || {}), ...(payload.connection || {}) }));
              break;
            case 'error':
              setError(payload.message || 'WebSocket error.');
              setGatewayState((s) => (s === GATEWAY_STATES.OPEN ? s : GATEWAY_STATES.ERROR));
              break;
            default:
              break;
          }
        };

        socket.onerror = () => {
          setError('Could not reach the WebSocket gateway.');
          setGatewayState(GATEWAY_STATES.ERROR);
          reject(new Error('gateway unreachable'));
        };

        socket.onclose = () => {
          gatewayRef.current = null;
          setGatewayState((s) => (s === GATEWAY_STATES.OPEN ? GATEWAY_STATES.CLOSED : s));
        };
      }),
    [appendMessage],
  );

  const send = useCallback((payload) => {
    const socket = gatewayRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  const connect = useCallback(
    async (config) => {
      setError('');
      setMessages([]);
      setConnection(null);
      setGatewayState(GATEWAY_STATES.CONNECTING);

      try {
        await openGateway((socket) =>
          socket.send(JSON.stringify({ type: 'connect', ...config, workspaceId: currentWorkspace() })),
        );
      } catch {
        // onerror already reported it.
      }
    },
    [openGateway],
  );

  const sendMessage = useCallback(
    (payload, context = {}) => {
      if (!connectionIdRef.current) return;
      send({ type: 'send', connectionId: connectionIdRef.current, payload, ...context, workspaceId: currentWorkspace() });
      setSentHistory((h) => [payload, ...h.filter((item) => item !== payload)].slice(0, 5));
    },
    [send],
  );

  const disconnect = useCallback(() => {
    if (connectionIdRef.current) send({ type: 'close', connectionId: connectionIdRef.current });
  }, [send]);

  const reconnect = useCallback(() => {
    if (connectionIdRef.current) send({ type: 'reconnect', connectionId: connectionIdRef.current });
  }, [send]);

  const refreshStatus = useCallback(() => {
    if (connectionIdRef.current) send({ type: 'status', connectionId: connectionIdRef.current });
  }, [send]);

  const clearMessages = useCallback(() => setMessages([]), []);

  /**
   * Tears everything down and returns to a blank slate.
   *
   * Closing the gateway socket is what matters: the server owns the target connections
   * opened through it and closes them when its client goes away, so this cannot leave
   * an orphaned socket alive on the backend.
   */
  const reset = useCallback(() => {
    closeGateway();
    setGatewayState(GATEWAY_STATES.IDLE);
    setConnection(null);
    setMessages([]);
    setError('');
    setSentHistory([]);
  }, [closeGateway]);

  return {
    gatewayState,
    connection,
    messages,
    error,
    sentHistory,
    isOpen: gatewayState === GATEWAY_STATES.OPEN,
    isBusy: gatewayState === GATEWAY_STATES.CONNECTING,
    connect,
    disconnect,
    reconnect,
    sendMessage,
    refreshStatus,
    clearMessages,
    reset,
  };
}
