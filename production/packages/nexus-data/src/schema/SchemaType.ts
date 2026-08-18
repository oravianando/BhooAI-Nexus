import { ObjectId, Decimal128, Binary } from 'mongodb';

/** Primitive type tokens understood by the ODM. */
export type SchemaTypeToken =
  | 'String'
  | 'Number'
  | 'Boolean'
  | 'Date'
  | 'Buffer'
  | 'ObjectId'
  | 'Decimal128'
  | 'Mixed'
  | 'Array'
  | 'Map';

/** Map a JS constructor to a type token. */
export function typeOf(ctor: unknown): SchemaTypeToken {
  switch (ctor) {
    case String: return 'String';
    case Number: return 'Number';
    case Boolean: return 'Boolean';
    case Date: return 'Date';
    case Buffer: return 'Buffer';
    case ObjectId: return 'ObjectId';
    case Decimal128: return 'Decimal128';
    case Binary: return 'Buffer';
    case Object: return 'Mixed';
    case Array: return 'Array';
    case Map: return 'Map';
    default: return 'Mixed';
  }
}

/** Coerce a value to the target type, throwing on impossible coercion. */
export function coerce(token: SchemaTypeToken, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  switch (token) {
    case 'String':
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return String(value);
      if (value instanceof ObjectId) return value.toHexString();
      throw new TypeError(`Cannot coerce ${typeof value} to String`);
    case 'Number': {
      const n = Number(value);
      if (Number.isNaN(n)) throw new TypeError(`Cannot coerce ${JSON.stringify(value)} to Number`);
      return n;
    }
    case 'Boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 1 || value === '1') return true;
      if (value === 'false' || value === 0 || value === '0') return false;
      throw new TypeError(`Cannot coerce ${JSON.stringify(value)} to Boolean`);
    case 'Date': {
      if (value instanceof Date) return value;
      const d = new Date(value as string);
      if (Number.isNaN(d.getTime())) throw new TypeError(`Cannot coerce ${JSON.stringify(value)} to Date`);
      return d;
    }
    case 'Buffer':
      if (Buffer.isBuffer(value)) return value;
      if (typeof value === 'string') return Buffer.from(value, 'utf8');
      throw new TypeError('Cannot coerce value to Buffer');
    case 'ObjectId':
      if (value instanceof ObjectId) return value;
      if (typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value)) return new ObjectId(value);
      throw new TypeError(`Cannot coerce ${JSON.stringify(value)} to ObjectId`);
    case 'Decimal128':
      if (value instanceof Decimal128) return value;
      if (typeof value === 'string' || typeof value === 'number') return Decimal128.fromString(String(value));
      throw new TypeError('Cannot coerce value to Decimal128');
    case 'Mixed':
    case 'Array':
    case 'Map':
      return value;
    default:
      return value;
  }
}

export { ObjectId, Decimal128 };