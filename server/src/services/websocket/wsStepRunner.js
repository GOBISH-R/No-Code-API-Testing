import crypto from 'node:crypto';
import * as manager from './connectionManager.js';
import { buildHandshake } from './handshake.js';
import { createMessage, DIRECTIONS } from './messageEngine.js';
import { createWaiter, normalizeTimeout, describeCondition } from './waitEngine.js';
import * as gqlWs from './graphqlWsProtocol.js';
import { runAssertions } from '../assertions/assertionEngine.js';
import { runCaptures } from '../variables/captureEngine.js';
import { resolveTextValue } from '../variables/variableResolver.js';
import { ValidationError } from '../../utils/errors.js';

// Hard ceiling on one WebSocket step regardless of how its waits are configured, so a
// collection run can never be held open by a socket that stays quiet.
const MAX_STEP_DURATION_MS = 2 * 60 * 1000;

function parsedPayload(message) {
  if (!message || message.type !== 'json') return message?.payload;
  try {
    return JSON.parse(message.payload);
  } catch {
    return message.payload;
  }
}

/**
 * Builds the context the shared assertion/capture engines evaluate against.
 *
 * `body` carries the parsed message so the ordinary `json` source — the same one HTTP
 * and GraphQL use — works on a WebSocket message with no special casing.
 */
function assertionContext(message, messageCount, connection) {
  return {
    body: parsedPayload(message),
    message,
    messageCount,
    connection,
  };
}

/**
 * Runs one saved WebSocket request: connect, then walk its steps, then disconnect.
 *
 * Never throws — like runStep in the collection runner, any failure becomes this
 * request's result so the rest of the run still proceeds.
 */
export async function runWebSocketRequest(request, variables = {}, { createSocket, ownerId } = {}) {
  const started = Date.now();
  const config = request.websocket || {};
  const received = [];
  let connectionId = null;
  let connectMs = null;
  let openedAt = null;

  // Messages arrive whenever the server feels like it; waiters registered by the
  // current step are offered each one as it lands.
  let activeWaiter = null;
  const stepResults = [];

  // Set once a subscription is live, so incoming frames are unwrapped rather than
  // treated as raw messages.
  let subscriptionId = null;
  let ackResolver = null;
  let subscriptionError = null;

  const onMessage = (message) => {
    if (subscriptionId !== null || ackResolver) {
      const handled = handleGraphQLFrame(message);
      if (handled) return;
    }
    received.push(message);
    activeWaiter?.offer(message);
  };

  /**
   * Turns a graphql-ws frame into either protocol bookkeeping or a normal message.
   *
   * A `next` frame's payload becomes the message body, so every assertion and capture
   * written for WebSocket — including plain `$.data.x` JSONPath — works on a
   * subscription with no special casing.
   */
  function handleGraphQLFrame(message) {
    const frame = gqlWs.classifyServerFrame(message.payload);

    switch (frame.kind) {
      case 'ack':
        ackResolver?.();
        ackResolver = null;
        return true;

      case 'ping':
        // Protocol-level keepalive: answer it, and keep it out of the message log.
        if (connectionId) manager.sendMessage(connectionId, gqlWs.pong(frame.payload));
        return true;

      case 'pong':
        return true;

      case 'next': {
        const payload = JSON.stringify(frame.payload ?? {});
        const unwrapped = createMessage({
          connectionId,
          direction: DIRECTIONS.RECEIVED,
          payload,
        });
        received.push(unwrapped);
        activeWaiter?.offer(unwrapped);
        return true;
      }

      case 'error':
        // The server has told us exactly what is wrong with the document. Recording it
        // is not enough — the waiting step must abort, otherwise the real reason is
        // replaced by a generic "timed out waiting for a message".
        subscriptionError = gqlWs.describeErrors(frame.errors);
        return true;

      case 'complete':
        subscriptionId = null;
        return true;

      default:
        // Not a graphql-ws frame — let it through as an ordinary message.
        return false;
    }
  }

  async function startSubscription(subscriptionConfig, id, _received, vars) {
    const timeoutMs = normalizeTimeout(subscriptionConfig.timeoutMs);

    let ackTimer = null;
    const acked = new Promise((resolve, reject) => {
      ackResolver = resolve;
      ackTimer = setTimeout(
        () => reject(new ValidationError('The server did not acknowledge the GraphQL subscription (no connection_ack).')),
        timeoutMs,
      );
      ackTimer.unref?.();
    });

    manager.sendMessage(id, gqlWs.connectionInit(subscriptionConfig.connectionParams || undefined));
    try {
      await acked;
    } finally {
      // The ack arrived, so the deadline is moot — left pending it would outlive the run.
      clearTimeout(ackTimer);
    }

    const { text: query, missing } = resolveTextValue(subscriptionConfig.query || '', vars);
    if (missing.length > 0) {
      throw new ValidationError(`Unresolved variable${missing.length > 1 ? 's' : ''}: ${missing.map((m) => `{{${m}}}`).join(', ')}.`);
    }

    let parsedVariables;
    if (subscriptionConfig.variables?.trim()) {
      const resolvedVars = resolveTextValue(subscriptionConfig.variables, vars).text;
      try {
        parsedVariables = JSON.parse(resolvedVars);
      } catch (err) {
        throw new ValidationError(`Subscription variables must be valid JSON: ${err.message}`);
      }
    }

    subscriptionId = crypto.randomUUID();
    manager.sendMessage(
      id,
      gqlWs.subscribe({
        id: subscriptionId,
        query,
        variables: parsedVariables,
        operationName: subscriptionConfig.operationName,
      }),
    );
    // A rejection cannot have arrived yet — the server has not seen the frame. It is
    // picked up by the steps' abort check, or by the post-run check if there are none.
  }

  const subscription = config.graphql?.enabled ? config.graphql : null;

  try {
    const configuredSubprotocols = (config.subprotocols || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const handshake = await buildHandshake(
      {
        url: request.url,
        params: request.params,
        headers: request.headers,
        auth: request.auth,
        // A GraphQL subscription is negotiated with a specific subprotocol; requesting
        // it is what tells the server to speak graphql-ws rather than raw frames.
        subprotocols: subscription
          ? [gqlWs.SUBPROTOCOL, ...configuredSubprotocols.filter((p) => p !== gqlWs.SUBPROTOCOL)]
          : configuredSubprotocols,
      },
      variables,
    );

    // Awaited for the open handshake itself; the resolved value is unused because the
    // connection id is captured from openConnection below.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ValidationError('Timed out waiting for the WebSocket connection to open.')),
        manager.LIMITS.CONNECT_TIMEOUT_MS + 2000,
      );

      manager
        .openConnection(
          { ...handshake, reconnect: config.reconnect, heartbeat: config.heartbeat },
          {
            onOpen: ({ id, protocol }) => {
              clearTimeout(timer);
              resolve({ id, protocol });
            },
            onMessage: ({ data, isBinary }) =>
              onMessage(
                createMessage({
                  connectionId,
                  direction: DIRECTIONS.RECEIVED,
                  payload: isBinary ? data : data.toString(),
                  isBinary: Boolean(isBinary),
                }),
              ),
            onError: ({ message }) => {
              clearTimeout(timer);
              reject(new ValidationError(message));
            },
            onClose: ({ code, reason }) => {
              clearTimeout(timer);
              reject(new ValidationError(`Connection closed before opening — code ${code}${reason ? `: ${reason}` : ''}`));
            },
          },
          // Test seam, matching the connection manager's: lets the whole
          // send/wait/assert sequence be driven without a network.
          { createSocket, ownerId },
        )
        .then(({ id }) => {
          connectionId = id;
        })
        .catch(reject);
    });

    openedAt = Date.now();
    connectMs = openedAt - started;

    // A subscription must complete its own handshake before any step can expect data.
    if (subscription) {
      await startSubscription(subscription, connectionId, received, variables);
    }

    const steps = config.steps?.length ? config.steps : [];
    const deadline = started + MAX_STEP_DURATION_MS;
    // `cursor` marks how far into `received` previous steps have already consumed, so a
    // step is offered new traffic only. Shared across steps, hence hoisted here.
    const ctx = { connectionId, received, variables, cursor: 0 };

    for (const [index, step] of steps.entries()) {
      if (Date.now() > deadline) {
        stepResults.push({
          name: step.name || `Step ${index + 1}`,
          success: false,
          error: 'The WebSocket step budget was exhausted before this step ran.',
        });
        break;
      }

      stepResults.push(await runStep(step, index, ctx));
    }

    const info = manager.describeConnection(connectionId);
    manager.closeConnection(connectionId, 'Run finished');

    // A subscription the server rejected is a failure even when no step was waiting on
    // it — otherwise a steps-less subscription request reports a misleading success.
    if (subscriptionError && stepResults.every((s) => s.success)) {
      stepResults.push({ name: 'GraphQL subscription', success: false, error: subscriptionError });
    }

    const failed = stepResults.filter((s) => !s.success);
    const assertionsPassed = stepResults.every((s) => !s.assertions || s.assertions.allPassed);

    return {
      success: failed.length === 0,
      error: failed.length > 0 ? failed[0].error : null,
      protocol: 'websocket',
      // response.time is populated so the dashboard's average keeps working across
      // every protocol rather than silently excluding WebSocket runs.
      response: { time: Date.now() - started, status: null, size: null },
      websocket: {
        connectMs,
        messagesSent: info?.messagesSent ?? 0,
        messagesReceived: received.length,
        reconnectAttempts: info?.reconnectAttempts ?? 0,
        durationMs: Date.now() - started,
        steps: stepResults,
      },
      // Flattened so History and Reports can display WebSocket outcomes with the same
      // components they already use for HTTP.
      assertions: mergeAssertions(stepResults),
      captures: stepResults.flatMap((s) => s.captures || []),
      allAssertionsPassed: assertionsPassed,
    };
  } catch (err) {
    if (connectionId) manager.forceClose(connectionId, 'Run failed');
    return {
      success: false,
      error: err instanceof ValidationError ? err.message : err.message || 'WebSocket step failed.',
      protocol: 'websocket',
      response: { time: Date.now() - started, status: null, size: null },
      websocket: {
        connectMs,
        messagesSent: 0,
        messagesReceived: received.length,
        reconnectAttempts: 0,
        durationMs: Date.now() - started,
        steps: stepResults,
      },
      assertions: mergeAssertions(stepResults),
      captures: [],
    };
  }

  async function runStep(step, index, ctx) {
    const label = step.name || `Step ${index + 1}`;

    try {
      if (step.send?.trim()) {
        const { text, missing } = resolveTextValue(step.send, ctx.variables);
        if (missing.length > 0) {
          throw new ValidationError(`Unresolved variable${missing.length > 1 ? 's' : ''}: ${missing.map((m) => `{{${m}}}`).join(', ')}.`);
        }
        manager.sendMessage(ctx.connectionId, text);
      }

      const condition = step.waitFor || { strategy: 'next' };
      const timeoutMs = normalizeTimeout(condition.timeoutMs);

      // Resolve variables inside the expectation too — waiting for a message about
      // {{userId}} captured by an earlier step is the whole point of chaining.
      const resolvedCondition = {
        ...condition,
        value: condition.value ? resolveTextValue(condition.value, ctx.variables).text : condition.value,
      };

      const waiter = createWaiter(resolvedCondition);
      activeWaiter = waiter;

      // Messages that landed since the previous step finished still count — a fast
      // server can reply before this step registers its waiter. Messages an earlier
      // step already consumed do not: replaying the whole history would let a `next`
      // wait match a stale message, and would make a `silence` wait — the way you prove
      // an unsubscribe worked — impossible to ever satisfy.
      for (const earlier of ctx.received.slice(ctx.cursor)) waiter.offer(earlier);

      const outcome = await waitWithTimeout(waiter, timeoutMs, () => subscriptionError);
      activeWaiter = null;
      ctx.cursor = ctx.received.length;

      // The server rejected the subscription mid-wait; report its reason rather than
      // the timeout that would otherwise follow.
      if (outcome.aborted) {
        return { name: label, success: false, error: outcome.aborted };
      }

      if (!outcome.satisfied) {
        return {
          name: label,
          success: false,
          error: `Timed out after ${timeoutMs}ms waiting for ${describeCondition(resolvedCondition)}.`,
          messagesSeen: outcome.seen?.length ?? 0,
        };
      }

      const connectionInfo = manager.describeConnection(ctx.connectionId);
      const context = assertionContext(outcome.matched, ctx.received.length, {
        state: connectionInfo?.state ?? 'closed',
        closeCode: connectionInfo?.closeCode ?? null,
        closeReason: connectionInfo?.closeReason ?? null,
      });

      const assertions =
        step.assertions?.length > 0 ? runAssertions(step.assertions, context, ctx.variables) : null;
      const captureResults = step.captures?.length > 0 ? runCaptures(step.captures, context) : null;

      // Captured values feed later steps *and* later requests in the run.
      for (const capture of captureResults || []) {
        if (capture.value !== undefined) ctx.variables[capture.variableName] = String(capture.value);
      }

      return {
        name: label,
        success: !assertions || assertions.allPassed,
        error: assertions && !assertions.allPassed ? `${assertions.passedCount}/${assertions.totalCount} assertions passed.` : null,
        matched: outcome.matched ? { payload: outcome.matched.payload, type: outcome.matched.type } : null,
        assertions,
        captures: captureResults,
      };
    } catch (err) {
      activeWaiter = null;
      return { name: label, success: false, error: err.message || 'Step failed.' };
    }
  }
}

// Resolves as soon as the waiter is satisfied, or when the clock runs out — whichever
// comes first. Polling keeps this independent of the transport.
function waitWithTimeout(waiter, timeoutMs, abortReason) {
  return new Promise((resolve) => {
    const started = Date.now();

    const check = () => {
      const result = waiter.result();
      if (result.satisfied) return resolve(result);
      // A silence wait is disproved the moment traffic arrives — no point burning the
      // rest of the window to report a failure we already know about.
      if (result.failedEarly) return resolve(result);
      // Checked before the clock so a known failure is reported as itself, not as a
      // timeout that happens to expire at the same moment.
      const aborted = abortReason?.();
      if (aborted) return resolve({ ...waiter.result(), satisfied: false, aborted });
      if (Date.now() - started >= timeoutMs) return resolve(waiter.settleOnTimeout());
      return setTimeout(check, 25).unref?.();
    };

    check();
  });
}

function mergeAssertions(stepResults) {
  const all = stepResults.flatMap((s) => s.assertions?.results || []);
  if (all.length === 0) return null;

  const passedCount = all.filter((r) => r.pass).length;
  return {
    results: all,
    passedCount,
    totalCount: all.length,
    allPassed: passedCount === all.length,
  };
}
