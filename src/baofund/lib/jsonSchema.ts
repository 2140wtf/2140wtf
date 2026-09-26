/**
 * jsonSchema - a tiny, dependency-free validator for the JSON-Schema subset
 * used by `schemas/*.json` (draft 2020-12 keywords: type, const, enum,
 * required, properties, additionalProperties, items, minItems, minLength,
 * minimum, pattern, oneOf).
 *
 * The schemas are the normative, portable contract for external implementers;
 * this module lets the repo's own test suite validate REAL builder output
 * against those exact files (so the published schemas cannot silently drift
 * from the code). It is deliberately not a general JSON-Schema engine - an
 * unsupported keyword is ignored, and the subset is documented in
 * schemas/README.md.
 */

export interface SchemaValidationError {
  /** JSON pointer-ish path to the offending value ('' = root). */
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
}

type JsonSchema = Record<string, unknown>;

const typeOf = (v: unknown): string => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v; // 'string' | 'number' | 'boolean' | 'object'
};

function matchesType(value: unknown, type: string): boolean {
  const t = typeOf(value);
  if (type === 'number') return t === 'number' || t === 'integer';
  return t === type;
}

function walk(schema: JsonSchema, value: unknown, path: string, errors: SchemaValidationError[]): void {
  // oneOf: exactly one branch must match (used for nullable object fields).
  if (Array.isArray(schema.oneOf)) {
    const pass = (schema.oneOf as JsonSchema[]).filter((s) => {
      const probe: SchemaValidationError[] = [];
      walk(s, value, path, probe);
      return probe.length === 0;
    });
    if (pass.length !== 1) {
      errors.push({ path, keyword: 'oneOf', message: `expected exactly one matching subschema, got ${pass.length}` });
      return;
    }
    return; // the matching branch already validated the value
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push({ path, keyword: 'type', message: `expected ${types.join('|')}, got ${typeOf(value)}` });
      return;
    }
  }
  if ('const' in schema && value !== schema.const) {
    errors.push({ path, keyword: 'const', message: `expected ${JSON.stringify(schema.const)}` });
  }
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) {
    errors.push({ path, keyword: 'enum', message: `not one of ${JSON.stringify(schema.enum)}` });
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ path, keyword: 'minLength', message: `shorter than ${schema.minLength}` });
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, keyword: 'pattern', message: `does not match ${schema.pattern}` });
    }
  }

  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) {
    errors.push({ path, keyword: 'minimum', message: `below minimum ${schema.minimum}` });
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push({ path, keyword: 'minItems', message: `fewer than ${schema.minItems} items` });
    }
    if (schema.items && typeof schema.items === 'object') {
      value.forEach((item, i) => walk(schema.items as JsonSchema, item, `${path}/${i}`, errors));
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties as JsonSchema | undefined) ?? {};
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in obj)) errors.push({ path: `${path}/${key}`, keyword: 'required', message: 'missing required property' });
    }
    for (const [key, child] of Object.entries(obj)) {
      const childSchema = props[key] as JsonSchema | undefined;
      if (childSchema) walk(childSchema, child, `${path}/${key}`, errors);
      else if (schema.additionalProperties === false) {
        errors.push({ path: `${path}/${key}`, keyword: 'additionalProperties', message: 'unexpected property' });
      }
    }
  }
}

/** Validate a value against a schema; returns [] when valid. */
export function validateAgainstSchema(schema: unknown, value: unknown): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];
  walk(schema as JsonSchema, value, '', errors);
  return errors;
}
