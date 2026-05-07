import { describe, expect, it } from 'vitest';

import { shouldUseCompanionForAgent } from '../../packages/adapter-cli/src/generated/adapter-helpers.js';

describe('adapter helper routing', () => {
  it('uses one-shot agent companion only for JSON-RPC engines', () => {
    expect(shouldUseCompanionForAgent({ id: 'codex', companion: { protocol: 'jsonrpc' } } as any)).toBe(true);
    expect(shouldUseCompanionForAgent({ id: 'gemini', companion: { protocol: 'acp' } } as any)).toBe(false);
    expect(shouldUseCompanionForAgent({ id: 'claude', companion: { protocol: 'stream-json' } } as any)).toBe(false);
    expect(shouldUseCompanionForAgent({ id: 'plain' } as any)).toBe(false);
  });
});
