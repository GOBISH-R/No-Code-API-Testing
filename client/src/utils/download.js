// Triggers a browser download of text already in memory, without a server round trip
// for the file itself.
export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Freed on the next tick so the click has taken effect first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJson(filename, data) {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json');
}

const EXTENSIONS = [
  [/json/, 'json'],
  [/html/, 'html'],
  [/xml/, 'xml'],
  [/csv/, 'csv'],
  [/javascript/, 'js'],
  [/css/, 'css'],
];

/** A file name for a saved response, its extension taken from the content type. */
export function responseFileName(status, contentType = '', isJson = false) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const ext = isJson ? 'json' : EXTENSIONS.find(([pattern]) => pattern.test(mime))?.[1] ?? 'txt';
  return `response-${status}.${ext}`;
}
