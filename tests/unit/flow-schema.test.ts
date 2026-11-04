import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  FLOW_SCHEMA_VERSION, canonicalize, checkRange, isUlid, parseFlowDocument,
  parseFlowJson, parsePortRef, parseSemver, satisfies, serializeFlow,
} from '../../packages/mod-flow/src/core/index.js';
import { doc, edge, node, ulid } from '../helpers/flow-doc.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'flow');

describe('flow schema — .agon-flow.json validation', () => {
  it('accepts a minimal well-formed document', () => {
    const result = parseFlowDocument(doc({ nodes: [node(ulid('CHAT'), 'chat-input', { paramKey: 'x' })] }));
    expect(result.ok).toBe(true);
  });

  it('rejects a non-ULID node id, addressed at the node', () => {
    const result = parseFlowDocument(doc({ nodes: [node('not-a-ulid', 'chat-input', { paramKey: 'x' })] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('SCHEMA_INVALID');
    expect(result.errors[0].message).toContain('ULID');
  });

  it('rejects a non-semver flow version', () => {
    const result = parseFlowDocument(doc({ nodes: [], version: '1.2' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.message.includes('semver'))).toBe(true);
  });

  it('rejects unknown keys (typos never pass silently)', () => {
    const raw = { ...doc({ nodes: [] }), noeds: [] };
    const result = parseFlowDocument(raw);
    expect(result.ok).toBe(false);
  });

  it('rejects an edge that is not a nodeId.port reference', () => {
    const id = ulid('CHAT');
    const result = parseFlowDocument(doc({ nodes: [node(id, 'chat-input', { paramKey: 'x' })], edges: [edge(id, `${id}.prompt`)] }));
    expect(result.ok).toBe(false);
  });

  it('rejects a schemaVersion newer than this build', () => {
    const result = parseFlowDocument(doc({ nodes: [], schemaVersion: FLOW_SCHEMA_VERSION + 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });

  it('turns malformed JSON into a schema error rather than throwing', () => {
    const result = parseFlowJson('{ not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('SCHEMA_INVALID');
  });

  it('splits a port ref at the FIRST dot so namespaced subflow ports survive', () => {
    expect(parsePortRef('NODE.text')).toEqual({ nodeId: 'NODE', port: 'text' });
    expect(parsePortRef('PARENT.CHILD.paramKey')).toEqual({ nodeId: 'PARENT', port: 'CHILD.paramKey' });
    expect(parsePortRef('nodot')).toBeNull();
  });

  it('validates ULIDs against the Crockford alphabet', () => {
    expect(isUlid(ulid('CHAT'))).toBe(true);
    expect(isUlid('01JIIIIIIIIIIIIIIIIIIIIIII')).toBe(false);
  });
});

describe('flow schema — deterministic serialization', () => {
  it('sorts object keys at every depth', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toEqual({ a: { c: 3, d: 2 }, b: 1 });
    expect(JSON.stringify(canonicalize({ b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
  });

  it('preserves array order (nodes stay in the author\'s order)', () => {
    expect(canonicalize([{ b: 1 }, { a: 2 }])).toEqual([{ b: 1 }, { a: 2 }]);
  });

  it('drops undefined fields so an omitted and an undefined field serialize alike', () => {
    expect(serializeFlow({ ...doc({ nodes: [] }), description: undefined })).toBe(
      serializeFlow(doc({ nodes: [] })),
    );
  });

  it('round-trips byte-identically (serialize → parse → serialize)', () => {
    const original = serializeFlow(doc({
      nodes: [node(ulid('CHAT'), 'chat-input', { paramKey: 'x', label: 'X' }, { label: 'Chat' })],
      description: 'round trip',
    }));
    const reparsed = parseFlowJson(original);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(serializeFlow(reparsed.document)).toBe(original);
  });

  it('every golden fixture on disk is already in canonical form', () => {
    const files = readdirSync(FIXTURES).filter((name) => name.endsWith('.agon-flow.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(FIXTURES, file), 'utf-8');
      const parsed = parseFlowJson(text, file);
      expect(parsed.ok, `${file} must parse`).toBe(true);
      if (!parsed.ok) continue;
      expect(serializeFlow(parsed.document), `${file} must be byte-identical after a save`).toBe(text);
    }
  });
});

describe('flow schema — semver ranges for subflow refs', () => {
  it('parses and compares versions', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseSemver('1.2')).toBeNull();
  });

  it('matches caret, tilde, exact, partial and comparator ranges', () => {
    expect(satisfies('1.2.3', '^1.2')).toBe(true);
    expect(satisfies('1.9.0', '^1.2')).toBe(true);
    expect(satisfies('2.0.0', '^1.2')).toBe(false);
    expect(satisfies('0.2.9', '^0.2.3')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.3')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '1.2')).toBe(true);
    expect(satisfies('1.3.0', '1.2')).toBe(false);
    expect(satisfies('1.5.0', '>=1.2.0 <2.0.0')).toBe(true);
    expect(satisfies('2.5.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfies('9.9.9', '*')).toBe(true);
  });

  it('reports a malformed range instead of silently matching', () => {
    expect(checkRange('1.2.3', 'not-a-range')).toEqual({ valid: false, satisfied: false });
  });

  it('rejects a malformed range rather than letting it match everything', () => {
    // A stray/empty `||` alternative used to be read as "match anything",
    // which silently BYPASSED the constraint the author actually wrote.
    for (const range of ['^1 ||', '|| ^1.0.0', '||', '', '   ', '1.x.2', 'x.2', '>=*', '<x', '^']) {
      expect({ range, ...checkRange('1.2.3', range) })
        .toEqual({ range, valid: false, satisfied: false });
    }
  });

  it('still accepts the wildcard and partial-wildcard ranges it documents', () => {
    for (const range of ['*', 'x', 'X', '1.x', '1.X.x', '>=1.0.0 <2.0.0', '^1.0.0 || ^2.0.0']) {
      expect({ range, ...checkRange('1.2.3', range) })
        .toEqual({ range, valid: true, satisfied: true });
    }
  });
});
