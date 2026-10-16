const BINARY_PREFIXES = ['image/', 'audio/', 'video/', 'font/'];
const BINARY_EXACT = ['application/octet-stream', 'application/pdf', 'application/zip', 'application/gzip'];

function rawMime(headers) {
  const value = headers?.['content-type'] || headers?.['Content-Type'];
  return value ? value.split(';')[0].trim().toLowerCase() : '';
}

export function contentTypeLabel(headers) {
  const mime = rawMime(headers);
  if (!mime) return null;
  if (mime === 'application/json') return 'JSON';
  if (mime.startsWith('text/html')) return 'HTML';
  if (mime.startsWith('text/')) return 'Text';
  if (BINARY_PREFIXES.some((p) => mime.startsWith(p)) || BINARY_EXACT.includes(mime)) return 'Binary';
  return mime;
}

export function isBinaryContentType(headers) {
  const mime = rawMime(headers);
  if (!mime) return false;
  return BINARY_PREFIXES.some((p) => mime.startsWith(p)) || BINARY_EXACT.includes(mime);
}
