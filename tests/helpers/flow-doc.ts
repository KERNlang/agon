/**
 * Tiny builders for `.agon-flow.json` documents used by the flow unit tests.
 * Keeps every failing fixture readable inline instead of scattering a dozen
 * near-identical JSON files across tests/fixtures.
 */
import type { FlowDocument, FlowEdge, FlowNode } from '../../packages/flow-core/src/index.js';

const ULID_ALPHABET_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Deterministic, readable ULIDs. Mnemonics must avoid I, L, O and U. */
export function ulid(mnemonic: string): string {
  const value = `01J${mnemonic.toUpperCase()}`.padEnd(26, '0');
  if (!ULID_ALPHABET_RE.test(value)) {
    throw new Error(`"${mnemonic}" is not a legal ULID mnemonic (avoid I, L, O, U): ${value}`);
  }
  return value;
}

export function node(
  id: string,
  type: string,
  params: Record<string, unknown> = {},
  extra: Partial<FlowNode> = {},
): FlowNode {
  return { id, type, params, position: { x: 0, y: 0 }, ...extra };
}

export function edge(from: string, to: string): FlowEdge {
  return { from, to };
}

export function doc(partial: Partial<FlowDocument> & { nodes: FlowNode[] }): FlowDocument {
  return {
    schemaVersion: 1,
    version: '1.0.0',
    id: ulid('TEST'),
    name: 'test-flow',
    params: [],
    edges: [],
    outputs: [],
    ...partial,
  };
}
