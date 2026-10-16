import { JSONPath } from 'jsonpath-plus';

// Pulls the "actual" value an assertion checks out of the executed response.
// Knows nothing about pass/fail — that's the comparator's job.
export function extractActualValue(assertion, context) {
  const { source, path, headerName } = assertion;
  const { status, headers, body, time, message, messageCount, connection } = context;

  switch (source) {
    case 'status':
      return { value: status };

    case 'time':
      return { value: time };

    // WebSocket sources. These are additions to the same engine rather than a second
    // one: the comparator, the assertion runner and the capture engine are all
    // unchanged, and `json` below works on a WebSocket message for free because the
    // caller puts the parsed payload in `body`.
    case 'message':
      return { value: message?.payload };

    case 'messageType':
      return { value: message?.type };

    case 'messageSize':
      return { value: message?.size };

    case 'messageCount':
      return { value: messageCount };

    case 'connection':
      return { value: connection?.state };

    case 'closeCode':
      return { value: connection?.closeCode };

    case 'closeReason':
      return { value: connection?.closeReason };

    case 'header': {
      const key = Object.keys(headers || {}).find(
        (h) => h.toLowerCase() === String(headerName).toLowerCase(),
      );
      return { value: key ? headers[key] : undefined };
    }

    case 'json': {
      try {
        const matches = JSONPath({ path, json: body, wrap: true });
        return { value: matches.length > 0 ? matches[0] : undefined };
      } catch {
        return { value: undefined, error: 'Invalid JSONPath expression.' };
      }
    }

    default:
      return { value: undefined };
  }
}
