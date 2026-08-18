import type { NexusSchema } from '../schema/Schema.js';
import type { Model } from './Model.js';
import { DocumentInstance } from './Document.js';

/** Build a Document instance from a raw Mongo doc (not new). */
export function hydrate<T extends DocumentInstance>(
  schema: NexusSchema,
  model: Model<T>,
  doc: Record<string, unknown>,
): T {
  return new DocumentInstance(schema, model, doc, false) as T;
}