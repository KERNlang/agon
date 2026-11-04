/**
 * Deterministic `.agon-flow.json` serialization.
 *
 * Object keys are emitted in sorted order at every depth, arrays keep their
 * authored order (node order is the author's, layout lives in `position`), and
 * the file always ends in a single newline. Two saves of an unchanged flow are
 * therefore byte-identical, which is what makes flows git-diffable and the
 * editor's open→save round-trip lossless.
 */
import type { FlowDocument } from '../models/types.js';

/** Recursively rebuilds `value` with every object's keys in sorted order. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    // `undefined` is not representable in JSON; dropping it here keeps the
    // canonical form stable whether a field was omitted or set to undefined.
    if (entry === undefined) continue;
    sorted[key] = canonicalize(entry);
  }
  return sorted;
}

/** Canonical JSON text for any value (no trailing newline). Used for hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Canonical `.agon-flow.json` file text, newline-terminated. */
export function serializeFlow(document: FlowDocument): string {
  return `${JSON.stringify(canonicalize(document), null, 2)}\n`;
}
