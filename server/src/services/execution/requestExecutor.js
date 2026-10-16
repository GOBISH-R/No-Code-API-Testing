import http from 'node:http';
import https from 'node:https';
import axios from 'axios';

const TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

function parseBody(rawText) {
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

function describeError(err) {
  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message)) {
    return { message: `The request timed out after ${TIMEOUT_MS / 1000}s.`, code: 'TIMEOUT' };
  }
  if (err.code === 'ENOTFOUND') {
    return { message: 'Could not resolve the host.', code: 'DNS_ERROR' };
  }
  if (err.code === 'ECONNREFUSED') {
    return { message: 'Connection refused by the target server.', code: 'CONNECTION_REFUSED' };
  }
  if (err.code === 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED' || err.code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED') {
    return { message: 'Response exceeded the maximum allowed size (5MB).', code: 'RESPONSE_TOO_LARGE' };
  }
  if (/certificate/i.test(err.message)) {
    return { message: 'SSL certificate error.', code: 'TLS_ERROR' };
  }
  return { message: err.message || 'Request execution failed.', code: err.code || 'EXECUTION_ERROR' };
}

const msSince = (start) => Number(process.hrtime.bigint() - start) / 1e6;

/**
 * Agents that note when each connection phase finished, the way Postman's timing
 * popover breaks a request down.
 *
 * A fresh pair per request, so the socket is always new and its phases are always this
 * request's own. Changes nothing about where the request goes: the target was already
 * validated by the caller, and these only listen to the socket the agent would have
 * opened anyway.
 */
function timedAgents(start, marks) {
  const instrument = (socket) => {
    socket.once('lookup', () => { marks.lookup ??= msSince(start); });
    socket.once('connect', () => { marks.connect ??= msSince(start); });
    socket.once('secureConnect', () => { marks.secure ??= msSince(start); });
    socket.once('data', () => { marks.firstByte ??= msSince(start); });
  };
  class TimedHttpAgent extends http.Agent {
    createConnection(...args) {
      const socket = super.createConnection(...args);
      instrument(socket);
      return socket;
    }
  }
  class TimedHttpsAgent extends https.Agent {
    createConnection(...args) {
      const socket = super.createConnection(...args);
      instrument(socket);
      return socket;
    }
  }
  return { httpAgent: new TimedHttpAgent(), httpsAgent: new TimedHttpsAgent() };
}

/**
 * Milliseconds spent in each phase, or null when the socket never reported enough to
 * say (e.g. a proxy in between). DNS is 0 for an IP address, TLS 0 for plain HTTP.
 * Exported for tests.
 */
export function phasesFrom(marks, total) {
  if (marks.connect === undefined || marks.firstByte === undefined) return null;
  const dns = marks.lookup ?? 0;
  const connected = marks.secure ?? marks.connect;
  const round = (n) => Math.max(0, Math.round(n));
  return {
    dns: round(dns),
    tcp: round(marks.connect - dns),
    tls: round(marks.secure !== undefined ? marks.secure - marks.connect : 0),
    wait: round(marks.firstByte - connected),
    download: round(total - marks.firstByte),
  };
}

// Approximate bytes of the response head as it arrived: the status line plus one
// "Name: value" line per header. Node has already parsed the original away, so this is
// rebuilt rather than measured — close enough for a size breakdown.
function headerBytes(response) {
  // Status line and the blank line that ends the head, each with its CRLF.
  let bytes = `HTTP/1.1 ${response.status} ${response.statusText ?? ''}`.length + 4;
  for (const [name, value] of Object.entries(response.headers || {})) {
    for (const v of Array.isArray(value) ? value : [value]) bytes += name.length + String(v).length + 4;
  }
  return bytes;
}

// Runs the actual HTTP call via Axios and reports status/time/size/headers/body.
// Deliberately has no knowledge of assertions — that stays in the (future) assertion engine.
export async function executeHttpRequest(axiosConfig) {
  const startedAt = process.hrtime.bigint();
  const marks = {};
  const agents = timedAgents(startedAt, marks);

  try {
    const response = await axios({
      ...axiosConfig,
      ...agents,
      timeout: TIMEOUT_MS,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      responseType: 'text',
      transformResponse: [(data) => data],
      validateStatus: () => true, // let the caller inspect 4xx/5xx instead of throwing
      // Redirects are followed by the caller, one hop at a time, so that each new
      // target goes through the SSRF guard. Letting Axios follow them internally would
      // defeat that guard completely: only the first URL is ever validated, so a public
      // host answering 302 with a link-local Location would reach it unchecked.
      maxRedirects: 0,
    });

    const elapsedMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    const rawText = typeof response.data === 'string' ? response.data : '';

    return {
      success: true,
      meta: { time: elapsedMs, phases: phasesFrom(marks, msSince(startedAt)) },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: parseBody(rawText),
        size: Buffer.byteLength(rawText, 'utf8'),
        headersSize: headerBytes(response),
      },
      error: null,
    };
  } catch (err) {
    const elapsedMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    return {
      success: false,
      meta: { time: elapsedMs },
      response: null,
      error: describeError(err),
    };
  } finally {
    agents.httpAgent.destroy();
    agents.httpsAgent.destroy();
  }
}
