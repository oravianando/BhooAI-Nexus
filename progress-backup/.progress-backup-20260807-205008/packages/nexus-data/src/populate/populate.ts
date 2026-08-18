import type { Connection } from '../connection/Connection.js';
import type { DocumentInstance } from '../model/Document.js';

interface PopulatePath {
  path: string;
  select?: string;
  match?: Record<string, unknown>;
}

/**
 * Resolve `ref` fields across documents in batched lookups (one query per
 * path, not one per document). Supports nested paths ("a.b"), array refs, and
 * `refPath` (dynamic model per document). Populated docs are hydrated and
 * assigned back onto the parent.
 */
export async function populate(
  connection: Connection,
  docs: DocumentInstance[],
  paths: string | PopulatePath[],
): Promise<void> {
  if (docs.length === 0) return;
  const list = typeof paths === 'string' ? [{ path: paths }] : paths;
  for (const p of list) await populateOne(connection, docs, p);
}

async function populateOne(
  connection: Connection,
  docs: DocumentInstance[],
  p: PopulatePath,
): Promise<void> {
  const segments = p.path.split('.');
  const head = segments[0]!;
  const rest = segments.slice(1).join('.');

  // Determine the ref model for this path. The field may use a static `ref`
  // (found on the schema of any doc) or a dynamic `refPath`.
  const sampleField = docs[0]?._schema.compiledPaths.get(head);
  if (!sampleField || (!sampleField.ref && !sampleField.refPath)) {
    throw new Error(`Path \`${head}\` is not a reference and cannot be populated.`);
  }

  // Collect ids (supporting arrays of refs).
  const ids = new Set<unknown>();
  for (const doc of docs) {
    const value = doc._doc[head];
    if (Array.isArray(value)) for (const v of value) ids.add(v);
    else if (value !== undefined && value !== null) ids.add(value);
  }
  if (ids.size === 0) return;

  // Group docs by target model name (for refPath) and resolve each group.
  const byModel = new Map<string, { model: string; ids: Set<unknown> }>();
  for (const doc of docs) {
    const field = doc._schema.compiledPaths.get(head)!;
    const modelName = field.refPath ? String(doc._doc[field.refPath]) : field.ref!;
    const entry = byModel.get(modelName) ?? { model: modelName, ids: new Set() };
    const value = doc._doc[head];
    if (Array.isArray(value)) for (const v of value) entry.ids.add(v);
    else if (value !== undefined && value !== null) entry.ids.add(value);
    byModel.set(modelName, entry);
  }

  for (const { model: modelName, ids: modelIds } of byModel.values()) {
    const targetModel = connection.models.get(modelName);
    if (!targetModel) throw new Error(`Model \`${modelName}\` is not registered.`);
    const projection = p.select ? buildProjection(p.select) : undefined;
    const found = await targetModel.collection.then((c) =>
      c.find({ _id: { $in: [...modelIds] }, ...(p.match ?? {}) }, projection ? { projection } : {}).toArray(),
    );
    const byId = new Map(found.map((d) => [String(d._id), d]));

    for (const doc of docs) {
      const field = doc._schema.compiledPaths.get(head)!;
      const targetName = field.refPath ? String(doc._doc[field.refPath]) : field.ref!;
      if (targetName !== modelName) continue;
      const value = doc._doc[head];
      if (Array.isArray(value)) {
        doc._doc[head] = value.map((id) => byId.get(String(id)) ?? id).filter((v) => v !== undefined);
        for (const child of doc._doc[head] as unknown[]) {
          if (child && typeof child === 'object' && '_doc' in (child as object)) continue;
        }
        // hydrate populated children
        doc._doc[head] = (doc._doc[head] as unknown[]).map((raw) =>
          raw && typeof raw === 'object' && !('_doc' in raw) ? targetModel.hydrate(raw as Record<string, unknown>) : raw,
        );
      } else {
        const raw = byId.get(String(value));
        if (raw) doc._doc[head] = targetModel.hydrate(raw);
      }
    }
  }

  // Recurse into nested populate paths.
  if (rest) {
    const children: DocumentInstance[] = [];
    for (const doc of docs) {
      const value = doc._doc[head];
      if (Array.isArray(value)) for (const v of value) if (v instanceof DocumentInstance) children.push(v);
      else if (value instanceof DocumentInstance) children.push(value);
    }
    if (children.length) await populateOne(connection, children, { path: rest, select: p.select, match: p.match });
  }
}

function buildProjection(select: string): Record<string, 0 | 1> {
  const proj: Record<string, 0 | 1> = {};
  for (const part of select.split(' ')) {
    if (!part) continue;
    const exclude = part.startsWith('-');
    proj[exclude ? part.slice(1) : part] = exclude ? 0 : 1;
  }
  return proj;
}