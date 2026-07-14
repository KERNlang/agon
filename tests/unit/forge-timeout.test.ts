import { describe, expect, it } from 'vitest';
import { resolveForgeDispatchTimeout, shouldHarvestFailedDispatch } from '../../packages/forge/src/generated/stages.js';
import { resolveForgeRunTimeout, resolveForgeSynthesisTimeout } from '../../packages/forge/src/generated/forge.js';

describe('forge dispatch timeout selection', () => {
  const config = { forgeTimeout: 600, forgeDispatchTimeout: 480 } as any;

  it('raises a short chat-calibrated engine timeout to the forge dispatch floor', () => {
    expect(resolveForgeDispatchTimeout({ id: 'codex', timeout: 120 }, config)).toBe(480);
  });

  it('honors longer per-engine forge timeouts above the floor', () => {
    expect(resolveForgeDispatchTimeout({ id: 'slow', timeout: 900 }, config)).toBe(900);
  });

  it('uses the forge dispatch floor when engine has no timeout', () => {
    expect(resolveForgeDispatchTimeout({ id: 'default' }, config)).toBe(480);
  });

  it('falls back to 480s built-in floor when forgeDispatchTimeout is not configured', () => {
    expect(resolveForgeDispatchTimeout({ id: 'default' }, { forgeTimeout: 600 } as any)).toBe(480);
  });

  it('does NOT use forgeTimeout (overall-run cap) as the per-engine floor — that was the 30-min hostage bug', () => {
    expect(resolveForgeDispatchTimeout({ id: 'codex', timeout: 120 }, { forgeTimeout: 1800, forgeDispatchTimeout: 480 } as any)).toBe(480);
    expect(resolveForgeDispatchTimeout({ id: 'codex', timeout: 120 }, { forgeTimeout: 1800 } as any)).toBe(480);
  });
});

describe('failed dispatch candidate harvesting', () => {
  it('rejects a missing dispatch result without throwing', () => {
    expect(shouldHarvestFailedDispatch(undefined)).toBe(false);
  });

  it('harvests a timed-out worktree for fitness', () => {
    expect(shouldHarvestFailedDispatch({ exitCode: 124, timedOut: true, diffLines: 0, filesChanged: 0 })).toBe(true);
  });

  it('harvests partial work when an agent failed after changing files', () => {
    expect(shouldHarvestFailedDispatch({ exitCode: 1, timedOut: false, diffLines: 8, filesChanged: 1 })).toBe(true);
  });

  it('does not harvest a failed dispatch with no candidate changes', () => {
    expect(shouldHarvestFailedDispatch({ exitCode: 1, timedOut: false, diffLines: 0, filesChanged: 0 })).toBe(false);
    expect(shouldHarvestFailedDispatch({ exitCode: 1, timedOut: false, diff: 'non-canonical marker', diffLines: 0, filesChanged: 0 })).toBe(false);
  });

  it('does not harvest cancellation even if partial changes exist', () => {
    expect(shouldHarvestFailedDispatch({ exitCode: 130, timedOut: false, diffLines: 8, filesChanged: 1 })).toBe(false);
    expect(shouldHarvestFailedDispatch({ exitCode: 1, cancelled: true, timedOut: false, diffLines: 8, filesChanged: 1 })).toBe(false);
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
