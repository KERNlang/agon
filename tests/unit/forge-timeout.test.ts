import { describe, expect, it } from 'vitest';
import { resolveForgeDispatchTimeout } from '../../packages/forge/src/generated/stages.js';

describe('forge dispatch timeout selection', () => {
  const config = { forgeTimeout: 600 } as any;

  it('uses shorter per-engine timeout for native user engines', () => {
    expect(resolveForgeDispatchTimeout({ id: 'kimi', timeout: 180 }, config)).toBe(180);
  });

  it('caps longer engine timeout at the forge global timeout', () => {
    expect(resolveForgeDispatchTimeout({ id: 'slow', timeout: 900 }, config)).toBe(600);
  });

  it('falls back to forge global timeout when engine has no timeout', () => {
    expect(resolveForgeDispatchTimeout({ id: 'default' }, config)).toBe(600);
  });
});
