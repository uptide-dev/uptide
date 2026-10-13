/**
 * The part of JSON Schema `uptide.yml` and the `uptide.run/v1` report use, and no more: a
 * validator library would be the CLI's largest new dependency for a dozen keywords. A test
 * fails if either schema ever uses a keyword outside `KEYWORDS`, so it cannot silently stop
 * being enforced.
 */
export const KEYWORDS = new Set([
  // Annotations: read by editors, never by the validator.
  '$schema',
  '$id',
  'title',
  'description',
  'default',
  // Assertions.
  'type',
  'const',
  'enum',
  'properties',
  'additionalProperties',
  'required',
  'items',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'minLength',
  'maxLength',
  'anyOf',
]);

type TypeName = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';
export interface Schema {
  type?: TypeName | readonly TypeName[];
  anyOf?: readonly Schema[];
  minLength?: number;
  maxLength?: number;
  const?: unknown;
  enum?: readonly unknown[];
  properties?: Readonly<Record<string, Schema>>;
  additionalProperties?: boolean;
  required?: readonly string[];
  items?: Schema;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
}

export type Path = (string | number)[];
export interface SchemaError {
  path: Path;
  message: string;
}

const kindOf = (value: unknown): string =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'a list'
      : typeof value === 'object'
        ? 'a mapping'
        : typeof value === 'string'
          ? 'text'
          : typeof value === 'boolean'
            ? 'true or false'
            : typeof value === 'number'
              ? 'a number'
              : typeof value;

const EXPECTED: Record<TypeName, string> = {
  object: 'a mapping',
  array: 'a list',
  string: 'text',
  integer: 'a whole number',
  number: 'a number',
  boolean: 'true or false',
  null: 'null',
};

function typeMatches(type: TypeName, value: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'object':
      return !!value && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeof value === type;
  }
}

const list = (values: readonly unknown[]): string => values.map((v) => String(v)).join(', ');

/** Every way `value` breaks `schema`, outermost first; a broken container is not descended into. */
export function validate(schema: Schema, value: unknown, path: Path = []): SchemaError[] {
  const fail = (message: string): SchemaError[] => [{ path, message }];
  if (schema.const !== undefined && value !== schema.const)
    return fail(`must be ${String(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value))
    return fail(`must be one of ${list(schema.enum)}`);
  const types = schema.type === undefined ? [] : ([] as TypeName[]).concat(schema.type);
  if (types.length && !types.some((t) => typeMatches(t, value)))
    return fail(`must be ${types.map((t) => EXPECTED[t]).join(' or ')}, not ${kindOf(value)}`);
  if (schema.anyOf) {
    const branches = schema.anyOf.map((branch) => validate(branch, value, path));
    if (branches.every((errors) => errors.length > 0))
      // The branch that got furthest says the most: fewest errors.
      return branches.reduce((a, b) => (b.length < a.length ? b : a));
  }
  const errors: SchemaError[] = [];
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return fail(`must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return fail(`must be at most ${schema.maxLength} characters`);
  }
  if (typeof value === 'number') {
    const range =
      schema.exclusiveMinimum !== undefined
        ? `more than ${schema.exclusiveMinimum}`
        : schema.minimum !== undefined
          ? `at least ${schema.minimum}`
          : undefined;
    const tooLow =
      (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) ||
      (schema.minimum !== undefined && value < schema.minimum);
    if (tooLow || (schema.maximum !== undefined && value > schema.maximum))
      return fail(
        `must be ${[range, schema.maximum !== undefined ? `at most ${schema.maximum}` : undefined]
          .filter(Boolean)
          .join(' and ')}`,
      );
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value))
    errors.push({ path, message: 'is not in the expected format' });
  if (Array.isArray(value) && schema.items)
    value.forEach((item, i) => {
      errors.push(...validate(schema.items as Schema, item, [...path, i]));
    });
  if (types.includes('object') && typeMatches('object', value)) {
    const record = value as Record<string, unknown>;
    for (const name of schema.required ?? [])
      if (!(name in record)) errors.push({ path: [...path, name], message: 'is required' });
    for (const [name, child] of Object.entries(record)) {
      const sub = schema.properties?.[name];
      if (sub) errors.push(...validate(sub, child, [...path, name]));
      else if (schema.additionalProperties === false) {
        const known = Object.keys(schema.properties ?? {});
        errors.push({
          path: [...path, name],
          message: `is not a setting${known.length ? ` here (known: ${known.join(', ')})` : ''}`,
        });
      }
    }
  }
  return errors;
}
