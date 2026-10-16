import { extractActualValue } from '../assertions/extractor.js';

// Runs each capture rule against a completed response and returns what was (or wasn't)
// captured. Reuses the same extractor assertions use — capturing is just "extract and
// store" rather than "extract and compare".
export function runCaptures(captures, context) {
  return (captures || [])
    .filter((capture) => capture?.variableName?.trim())
    .map((capture) => {
      const { value, error } = extractActualValue(capture, context);
      const notFound = value === undefined && !error;

      return {
        variableName: capture.variableName.trim(),
        source: capture.source,
        path: capture.path,
        headerName: capture.headerName,
        value: error || notFound ? undefined : value,
        error: error || (notFound ? 'Value not found.' : null),
      };
    });
}
