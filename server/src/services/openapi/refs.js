// Resolves a local "#/a/b/c" JSON Pointer-style $ref within the spec document itself.
// Deliberately does not follow external file or URL refs — a spec is untrusted input,
// and fetching whatever it points to would be an SSRF vector during parsing, not just
// during request execution.
function resolveRef(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;

  const path = ref.slice(2).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let node = spec;
  for (const segment of path) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[segment];
  }
  return node;
}

// A $ref-bearing node might itself point at another $ref-bearing node; follow a bounded
// chain rather than recursing forever on a (malformed or malicious) circular reference.
export function resolveNode(spec, node, maxHops = 10) {
  let current = node;
  for (let i = 0; i < maxHops && current?.$ref; i++) {
    current = resolveRef(spec, current.$ref);
  }
  return current;
}
