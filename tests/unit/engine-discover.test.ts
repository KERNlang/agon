import { describe, it, expect, afterEach } from 'vitest';
import { discoverEngines } from '../../packages/core/src/blocks/engine-discover.js';
import { EngineRegistry } from '../../packages/core/src/signals/engine-registry.js';
import type { EngineAdapter, EngineDefinition } from '../../packages/core/src/models/types.js';

// Only env vars flagged `required` may land in missingEnv. An optional var
// that happens to be unset is NOT a discovery problem — reporting it flips
// envOk to false and makes `agon doctor` mark healthy engines as broken.

const TOUCHED = ['AGON_TEST_REQUIRED_VAR', 'AGON_TEST_OPTIONAL_VAR', 'AGON_TEST_PRESENT_VAR'];

function engine(id: string, env: EngineDefinition['env']): EngineDefinition {
  return {
    id,
    displayName: id.toUpperCase(),
    // Deliberately unresolvable so isAvailable() is false and getVersion is never called.
    command: 'agon-nonexistent-binary-for-tests',
    args: [],
    env,
  } as unknown as EngineDefinition;
}

const adapter = {
  getVersion: async () => { throw new Error('adapter should not be consulted for a missing binary'); },
} as unknown as EngineAdapter;

afterEach(() => {
  for (const key of TOUCHED) delete process.env[key];
});

describe('discoverEngines env reporting', () => {
  it('reports only the unset REQUIRED vars as missing', async () => {
    for (const key of TOUCHED) delete process.env[key];
    const registry = new EngineRegistry();
    registry.register(engine('mixed', {
      AGON_TEST_REQUIRED_VAR: { required: true },
      AGON_TEST_OPTIONAL_VAR: { required: false },
    }));

    const [result] = await discoverEngines(registry, adapter);
    expect(result.missingEnv).toEqual(['AGON_TEST_REQUIRED_VAR']);
    expect(result.envOk).toBe(false);
    expect(result.found).toBe(false);
    expect(result.version).toBeNull();
  });

  it('treats an unset OPTIONAL var as healthy', async () => {
    delete process.env.AGON_TEST_OPTIONAL_VAR;
    const registry = new EngineRegistry();
    registry.register(engine('optional-only', { AGON_TEST_OPTIONAL_VAR: { required: false } }));

    const [result] = await discoverEngines(registry, adapter);
    expect(result.missingEnv).toEqual([]);
    expect(result.envOk).toBe(true);
  });

  it('treats a var with no `required` flag as optional', async () => {
    delete process.env.AGON_TEST_OPTIONAL_VAR;
    const registry = new EngineRegistry();
    registry.register(engine('unflagged', { AGON_TEST_OPTIONAL_VAR: {} }));

    const [result] = await discoverEngines(registry, adapter);
    expect(result.missingEnv).toEqual([]);
    expect(result.envOk).toBe(true);
  });

  it('clears a required var from missingEnv once it is set', async () => {
    process.env.AGON_TEST_PRESENT_VAR = 'sk-test';
    const registry = new EngineRegistry();
    registry.register(engine('present', { AGON_TEST_PRESENT_VAR: { required: true } }));

    const [result] = await discoverEngines(registry, adapter);
    expect(result.missingEnv).toEqual([]);
    expect(result.envOk).toBe(true);
  });
});
