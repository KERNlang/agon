const ALLOWED_KEYWORDS = new Set([
  '$schema', 'title', 'description', 'default', 'type', 'enum', 'const',
  'required', 'properties', 'additionalProperties', 'items',
  'minItems', 'maxItems',
  'minLength', 'maxLength', 'pattern', 'minimum', 'maximum',
]);

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validate(schema: Record<string, unknown>, value: unknown, path: string, depth: number): string | null {
  if (depth > 32) return `${path}: schema depth exceeds 32`;
  const unknown = Object.keys(schema).filter((key) => !ALLOWED_KEYWORDS.has(key));
  if (unknown.length) return `${path}: unsupported schema keyword ${unknown.sort()[0]}`;
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => same(candidate, value))) return `${path}: value is not in enum`;
  if ('const' in schema && !same(schema.const, value)) return `${path}: value does not equal const`;
  const type = schema.type;
  if (typeof type !== 'string') return `${path}: schema requires one explicit type`;
  if (type === 'null') return value === null ? null : `${path}: expected null`;
  if (type === 'boolean') return typeof value === 'boolean' ? null : `${path}: expected boolean`;
  if (type === 'string') {
    if (typeof value !== 'string') return `${path}: expected string`;
    if (Number.isInteger(schema.minLength) && value.length < Number(schema.minLength)) return `${path}: string is too short`;
    if (Number.isInteger(schema.maxLength) && value.length > Number(schema.maxLength)) return `${path}: string is too long`;
    if (typeof schema.pattern === 'string') {
      try { if (!new RegExp(schema.pattern, 'u').test(value)) return `${path}: string does not match pattern`; }
      catch { return `${path}: schema pattern is invalid`; }
    }
    return null;
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) return `${path}: expected ${type}`;
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path}: number is below minimum`;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path}: number is above maximum`;
    return null;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return `${path}: expected array`;
    for (const key of ['minItems', 'maxItems']) {
      if (key in schema && (!Number.isSafeInteger(schema[key]) || Number(schema[key]) < 0)) return `${path}: invalid ${key}`;
    }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${path}: array has too few items`;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${path}: array has too many items`;
    if (!plain(schema.items)) return `${path}: array schema requires object items`;
    for (let index = 0; index < value.length; index += 1) {
      const failure = validate(schema.items, value[index], `${path}[${index}]`, depth + 1);
      if (failure) return failure;
    }
    return null;
  }
  if (type === 'object') {
    if (!plain(value)) return `${path}: expected object`;
    const properties = schema.properties === undefined ? {} : schema.properties;
    if (!plain(properties)) return `${path}: properties must be an object`;
    const required = schema.required === undefined ? [] : schema.required;
    if (!Array.isArray(required) || required.some((key) => typeof key !== 'string')) return `${path}: required must contain strings`;
    for (const key of required) if (!(key in value)) return `${path}.${key}: required property is missing`;
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (childSchema === undefined) {
        if (schema.additionalProperties === false) return `${path}.${key}: additional property is forbidden`;
        if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
          if (!plain(schema.additionalProperties)) return `${path}: additionalProperties must be boolean or schema`;
          const failure = validate(schema.additionalProperties, child, `${path}.${key}`, depth + 1);
          if (failure) return failure;
        }
        continue;
      }
      if (!plain(childSchema)) return `${path}.${key}: property schema must be an object`;
      const failure = validate(childSchema, child, `${path}.${key}`, depth + 1);
      if (failure) return failure;
    }
    return null;
  }
  return `${path}: unsupported schema type ${type}`;
}

/** Fail-closed runtime validation for the documented external Mod API schema subset. */
export function validateContributionInput(schema: Readonly<Record<string, unknown>>, value: unknown): string | null {
  if (!plain(schema)) return '$: input schema must be a plain object';
  return validate(schema, value, '$', 0);
}

export function assertContributionInput(schema: Readonly<Record<string, unknown>>, value: unknown): void {
  const failure = validateContributionInput(schema, value);
  if (failure) throw new TypeError(`external contribution input does not match its schema: ${failure}`);
}
