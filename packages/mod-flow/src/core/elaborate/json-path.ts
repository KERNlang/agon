/**
 * Static validation of a dotted field access against a declared JSON schema.
 *
 * Deliberately conservative: a miss is only reported when the schema actually
 * DESCRIBES the level being accessed (it has `properties`, or it is an array
 * and the access is not an index). An under-specified schema stays
 * unverifiable rather than producing a false elaboration error — free-form
 * engine output is runtime-checked, per spec.
 */
import type { JsonSchemaNode } from '../models/types.js';

export interface FieldMiss {
  /** The prefix that resolved, e.g. `items[0]`. */
  at: string;
  segment: string;
  available: string[];
}

function isObjectSchema(schema: JsonSchemaNode): boolean {
  return schema.properties !== undefined && typeof schema.properties === 'object';
}

function schemaTypeIncludes(schema: JsonSchemaNode, type: string): boolean {
  if (Array.isArray(schema.type)) return schema.type.includes(type);
  return schema.type === type;
}

/**
 * Returns the miss, or null when the path is valid (or unverifiable).
 * Supported syntax: `a.b.c` and array traversal via a numeric segment
 * (`items.0.name`) or a bare step into an array's `items`.
 */
export function checkFieldPath(schema: JsonSchemaNode, path: string): FieldMiss | null {
  const segments = path.split('.').filter((segment) => segment !== '');
  let current: JsonSchemaNode = schema;
  const walked: string[] = [];

  for (const segment of segments) {
    // Step through an array wrapper: `files.0.name` and `files.name` both
    // descend into `items` when the current level is an array.
    if (schemaTypeIncludes(current, 'array') || current.items !== undefined) {
      const items = current.items;
      if (!items || typeof items !== 'object') return null; // unverifiable
      current = items as JsonSchemaNode;
      if (/^\d+$/.test(segment)) {
        walked.push(segment);
        continue;
      }
    }

    if (!isObjectSchema(current)) return null; // unverifiable level

    const properties = current.properties as Record<string, JsonSchemaNode>;
    const next = properties[segment];
    if (next === undefined) {
      return {
        at: walked.length === 0 ? '(root)' : walked.join('.'),
        segment,
        available: Object.keys(properties).sort(),
      };
    }
    walked.push(segment);
    current = next;
  }
  return null;
}

export function describeFieldMiss(path: string, miss: FieldMiss): string {
  const available = miss.available.length > 0
    ? ` — available at ${miss.at}: ${miss.available.join(', ')}`
    : '';
  return `field "${path}" is not present in the upstream declared JSON schema (missing "${miss.segment}" at ${miss.at})${available}`;
}
