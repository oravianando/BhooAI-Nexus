/**
 * Deep merge of plain objects. Later sources win. Arrays are replaced, not
 * concatenated (config arrays are declarative). Non-plain objects (e.g. Date,
 * RegExp) are assigned by reference.
 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

export function deepMerge<T>(base: T, ...sources: unknown[]): T {
  if (!isPlainObject(base)) return (sources.at(-1) as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      const current = out[key];
      if (isPlainObject(current) && isPlainObject(value)) {
        out[key] = deepMerge(current, value);
      } else {
        out[key] = value;
      }
    }
  }
  return out as T;
}