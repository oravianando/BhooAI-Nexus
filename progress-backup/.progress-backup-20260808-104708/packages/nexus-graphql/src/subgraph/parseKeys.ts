/**
 * Parse `@key(fields: "...")` directives from subgraph SDL to learn which types
 * are entities and what their key field paths are. This is a pragmatic regex scan
 * (not a full SDL parser) — sufficient for the v1 federation subset and for the
 * composition step in Phase 6. Composite keys like `@key(fields: "id tenant")` are
 * supported (space-separated, as in the spec).
 */
export function parseEntityKeys(typeDefs: string): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  // Match `type X ... {` or `extend type X ... {` (and interfaces) up to the body.
  const typeHeader = /(?:extend\s+)?(?:type|interface)\s+(\w+)([^{]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = typeHeader.exec(typeDefs)) !== null) {
    const name = m[1]!;
    const header = m[2]!;
    const keyFields: string[] = [];
    const keyRe = /@key\s*\(\s*fields:\s*"([^"]+)"\s*\)/g;
    let k: RegExpExecArray | null;
    while ((k = keyRe.exec(header)) !== null) {
      keyFields.push(...k[1]!.split(/\s+/).filter(Boolean));
    }
    if (keyFields.length) keys.set(name, keyFields);
  }
  return keys;
}