import { getCollectionWithRequests } from '../collections/collectionService.js';
import { TestRun } from '../../models/TestRun.js';
import { owned } from '../owned.js';
import { executeRequest } from '../execution/executionEngine.js';
import { runWebSocketRequest } from '../websocket/wsStepRunner.js';
import { runAssertions } from '../assertions/assertionEngine.js';
import { runCaptures } from '../variables/captureEngine.js';
import { describeRow } from '../../validators/datasetValidator.js';
import { ValidationError } from '../../utils/errors.js';
import { createConcurrencyGate } from '../../utils/concurrencyGate.js';

// Runs one saved request against the run's accumulated variables, mirroring the manual
// execute flow (executionEngine -> assertions -> captures) but never throwing: any
// failure becomes this step's own result so the rest of the run still proceeds.
async function runStep(request, variables, ownerId) {
  // WebSocket steps hold a connection open and exchange several messages, which the
  // one-shot HTTP engine cannot express — so they run through their own executor
  // while still using the same assertion, capture and variable services.
  if (request.protocol === 'websocket') {
    const result = await runWebSocketRequest(request, variables, { ownerId });
    const captured = {};
    for (const capture of result.captures || []) {
      if (capture.value !== undefined) captured[capture.variableName] = String(capture.value);
    }
    return { result, captured };
  }

  let executionResult;
  try {
    executionResult = await executeRequest(request, variables);
  } catch (err) {
    const message = err instanceof ValidationError ? err.message : err.message || 'Execution failed.';
    return { result: { success: false, error: message }, captured: {} };
  }

  if (!executionResult.success) {
    return { result: { success: false, error: executionResult.error?.message || 'Request failed.' }, captured: {} };
  }

  const context = {
    status: executionResult.response.status,
    headers: executionResult.response.headers,
    body: executionResult.response.body,
    time: executionResult.meta.time,
  };

  // Variables are passed so an expected value can reference the dataset row driving
  // this iteration — the whole point of a data-driven assertion.
  const assertions =
    Array.isArray(request.assertions) && request.assertions.length > 0
      ? runAssertions(request.assertions, context, variables)
      : null;

  const captureResults =
    Array.isArray(request.captures) && request.captures.length > 0
      ? runCaptures(request.captures, context)
      : null;

  const captured = {};
  for (const c of captureResults || []) {
    if (c.value !== undefined) captured[c.variableName] = String(c.value);
  }

  return {
    result: {
      success: true,
      error: null,
      response: {
        status: executionResult.response.status,
        time: executionResult.meta.time,
        size: executionResult.response.size,
      },
      assertions,
      captures: captureResults,
    },
    captured,
  };
}

function overallStatus(results) {
  if (results.some((r) => !r.success)) return 'error';
  if (results.some((r) => r.assertions && !r.assertions.allPassed)) return 'failed';
  return 'passed';
}

// A run is sequential and each step can burn the executor's full 15s timeout, so a
// large collection could otherwise grind for well over an hour — long after the
// browser gave up waiting and with no result ever persisted. Past this budget the run
// stops early and reports what it got, which is far more useful than an abandoned run.
const MAX_RUN_DURATION_MS = 5 * 60 * 1000;

// Sequential collection run: each step's captures merge into a run-local variable
// context available to every later step. This context is fresh per run — deliberately
// separate from a browser tab's manual runtime context (Phase 8/10), so an automated
// run never depends on, or pollutes, anyone's in-progress manual chain.
export const runGate = createConcurrencyGate({ perKey: 2, total: 50, label: 'collection run' });

export async function runCollection(ownerId, collectionId, options = {}) {
  const release = runGate.acquire(ownerId);
  try {
    return await runCollectionUnguarded(ownerId, collectionId, options);
  } finally {
    release();
  }
}

async function runCollectionUnguarded(
  ownerId,
  collectionId,
  { environmentId = null, variables = {}, dataset = null, monitor = null } = {},
) {
  const collection = await getCollectionWithRequests(ownerId, collectionId);
  if (!collection) return null;

  if (collection.requests.length === 0) {
    throw new ValidationError('This collection has no requests to run.');
  }

  const startedAt = new Date();
  const deadline = Date.now() + MAX_RUN_DURATION_MS;
  const results = [];
  let stoppedEarly = false;

  // No dataset is one nameless iteration, so the loop below is the only run path there
  // is — a data-driven run is the same runner fed different variables, not a second one.
  const rows = dataset?.length ? dataset : [null];

  for (const [rowIndex, row] of rows.entries()) {
    // Captures are per-iteration. Sharing them across rows would let a token captured
    // from row 1 satisfy row 2's request, hiding a failure the data was meant to expose.
    const runContext = {};
    const iteration = dataset?.length ? rowIndex + 1 : null;
    const iterationLabel = dataset?.length ? describeRow(row, rowIndex) : '';

    for (const request of collection.requests) {
      if (Date.now() > deadline) {
        stoppedEarly = true;
        break;
      }

      // Dataset values outrank the environment (they are this iteration's input) but not
      // captures, which are produced by the iteration itself.
      // Spreading the null sentinel is a no-op, so no dataset simply contributes nothing.
      const stepVariables = { ...variables, ...row, ...runContext };
      const { result, captured } = await runStep(request, stepVariables, ownerId);

      results.push({
        requestId: request._id,
        requestName: request.name,
        protocol: request.protocol || 'rest',
        method: request.method,
        url: request.url,
        iteration,
        iterationLabel,
        ...result,
      });

      Object.assign(runContext, captured);
    }

    if (stoppedEarly) break;
  }

  // A run cut short is reported as an error rather than a pass: the remaining requests
  // were never verified, so calling it "passed" would be a lie.
  if (stoppedEarly) {
    // Counted against every planned iteration, not just one pass of the collection —
    // otherwise a data-driven run reports a nonsensical (often negative) shortfall.
    const planned = collection.requests.length * rows.length;
    results.push({
      requestName: `Run stopped after ${MAX_RUN_DURATION_MS / 60000} minutes`,
      method: '—',
      url: '',
      success: false,
      error: `This run exceeded its ${MAX_RUN_DURATION_MS / 60000}-minute budget and stopped early. ${
        planned - results.length
      } request(s) did not execute.`,
    });
  }

  const completedAt = new Date();

  return owned(TestRun, ownerId).create({
    collectionId: collection._id,
    collectionName: collection.name,
    environmentId: environmentId || null,
    status: overallStatus(results),
    startedAt,
    completedAt,
    requestCount: results.length,
    iterationCount: rows.length,
    trigger: monitor ? 'monitor' : 'manual',
    monitorId: monitor?._id ?? null,
    monitorName: monitor?.name ?? '',
    results,
  });
}
