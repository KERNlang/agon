import { describe, expect, it } from 'vitest';
import { resolveForgeDispatchTimeout } from '../../packages/forge/src/generated/stages.js';
import { resolveForgeRunTimeout, resolveForgeSynthesisTimeout } from '../../packages/forge/src/generated/forge.js';

describe('forge dispatch timeout selection', () => {
  const config = { forgeTimeout: 600 } as any;

  it('does not let short per-engine chat defaults cut off forge work', () => {
    expect(resolveForgeDispatchTimeout({ id: 'codex', timeout: 120 }, config)).toBe(600);
  });

  it('honors longer per-engine forge timeouts', () => {
    expect(resolveForgeDispatchTimeout({ id: 'slow', timeout: 900 }, config)).toBe(900);
  });

  it('falls back to forge global timeout when engine has no timeout', () => {
    expect(resolveForgeDispatchTimeout({ id: 'default' }, config)).toBe(600);
  });
});

describe('forge synthesis timeout selection', () => {
  const config = { forgeSynthesisTimeout: 300 } as any;

  it('caps docs synthesis so a finished forge does not linger for five minutes', () => {
    expect(resolveForgeSynthesisTimeout(config, 'docs')).toBe(90);
  });

  it('keeps the configured synthesis timeout for code tasks', () => {
    expect(resolveForgeSynthesisTimeout(config, 'feature')).toBe(300);
  });
});

describe('forge run timeout selection', () => {
  const config = { forgeTimeout: 600 } as any;

  it('uses the configured forge timeout for docs tasks', () => {
    expect(resolveForgeRunTimeout(config, undefined, 'docs')).toBe(600);
  });

  it('honors explicit timeout for docs tasks', () => {
    expect(resolveForgeRunTimeout(config, 420, 'docs')).toBe(420);
  });

  it('uses the configured forge timeout for small implementation tasks', () => {
    expect(resolveForgeRunTimeout(config, undefined, 'bugfix')).toBe(600);
    expect(resolveForgeRunTimeout(config, undefined, 'refactor')).toBe(600);
  });

  it('uses the configured forge timeout for larger implementation tasks', () => {
    expect(resolveForgeRunTimeout(config, undefined, 'feature')).toBe(600);
  });

  it('defaults to a long forge timeout when config is missing', () => {
    expect(resolveForgeRunTimeout({} as any, undefined, 'bugfix')).toBe(1800);
  });
});
