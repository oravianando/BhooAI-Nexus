/**
 * Parse federation metadata from subgraph SDL: per type, its `@key` sets,
 * whether it is an `@extends` extension, and per field whether it is
 * `@external`, `@provides(fields)`, or `@requires(fields)`. Uses brace matching
 * (not a full AST) — sufficient for the v1 federation subset and the kind of
 * type blocks we generate/accept.
 */
export interface FieldMeta {
  /** Field is declared `@external` (resolved by another subgraph). */
  external: boolean;
  /** `@provides(fields: "...")` — this subgraph provides this field on an entity. */
  provides?: string[];
  /** `@requires(fields: "...")` — this field is computed from external fields. */
  requires?: string[];
}
export interface TypeMeta {
  isExtend: boolean;
  keys: string[][];
  fields: Map<string, FieldMeta>;
}

export function parseFederationMetadata(sdl: string): Map<string, TypeMeta> {
  const types = new Map<string, TypeMeta>();
  // Find `type|interface Name <header> {` and capture the balanced body.
  const headerRe = /(?:extend\s+)?(?:type|interface)\s+(\w+)([^{]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(sdl)) !== null) {
    const name = m[1]!;
    const header = m[2]!;
    const bodyStart = m.index + m[0].length;
    const body = balancedBody(sdl, bodyStart);
    headerRe.lastIndex = bodyStart + body.length + 1; // skip past closing brace

    const isExtend = /\bextends\b/.test(header) || /@extends\b/.test(header);
    const keys: string[][] = [];
    const keyRe = /@key\s*\(\s*fields:\s*"([^"]+)"\s*\)/g;
    let k: RegExpExecArray | null;
    while ((k = keyRe.exec(header)) !== null) keys.push(k[1]!.split(/\s+/).filter(Boolean));

    const fields = parseFields(body);
    const existing = types.get(name);
    if (existing) {
      existing.keys.push(...keys);
      for (const [fn, fm] of fields) existing.fields.set(fn, fm);
    } else {
      types.set(name, { isExtend, keys, fields });
    }
  }
  return types;
}

/** Extract the balanced `{ ... }` body starting just after an opening brace at `start-1`. */
function balancedBody(s: string, start: number): string {
  let depth = 1;
  let i = start;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return s.slice(start, i);
}

/** Parse field definitions in a type body into name → FieldMeta. */
function parseFields(body: string): Map<string, FieldMeta> {
  const out = new Map<string, FieldMeta>();
  // Each field line roughly: `name(args): Type <directives>` separated by newlines.
  // We scan line-ish fragments split on top-level commas/newlines.
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Strip leading modifiers; capture field name as the first identifier.
    const nameMatch = /^(\w+)/.exec(line);
    if (!nameMatch) continue;
    const name = nameMatch[1]!;
    const external = /@external\b/.test(line);
    const provides = matchFields(line, '@provides');
    const requires = matchFields(line, '@requires');
    out.set(name, { external, provides, requires });
  }
  return out;
}

function matchFields(line: string, directive: string): string[] | undefined {
  const re = new RegExp(`${directive}\\s*\\(\\s*fields:\\s*"([^"]+)"\\s*\\)`);
  const m = re.exec(line);
  return m ? m[1]!.split(/\s+/).filter(Boolean) : undefined;
}