import { describe, it, expect, vi } from 'vitest';
import { EngineNotFoundError } from '../../packages/core/src/models/errors.js';

it('preserves public host error identity and inheritance', async () => {
  const compatibility = await import('../../packages/core/src/models/errors.js');
  const kernel = await import('@kernlang/agon-kernel');
  const runtime = await import('@kernlang/agon-support-engine-runtime');
  const worktree = await import('@kernlang/agon-support-worktree');
  const forge = await import('@kernlang/agon-mod-forge');
  expect(kernel).toHaveProperty('AgonError', runtime.AgonError);
  expect(compatibility.FitnessError).toBe(forge.FitnessError);
  expect(kernel).toHaveProperty('ConfigError', compatibility.ConfigError);
  for (const name of ['GitError', 'WorktreeError', 'PlanStateError'] as const) {
    expect(worktree).toHaveProperty(name, compatibility[name]);
  }
  expect(new compatibility.ConfigError('invalid')).toBeInstanceOf(compatibility.AgonError);
  expect(new compatibility.GitError('failed', 128)).toMatchObject({ name: 'GitError', message: 'failed', exitCode: 128 });
  expect(new compatibility.WorktreeError('blocked')).toBeInstanceOf(compatibility.GitError);
  expect(new compatibility.PlanStateError(['draft', 'approved'], 'running')).toMatchObject({
    name: 'PlanStateError', expected: ['draft', 'approved'], actual: 'running',
    message: 'Invalid plan state: expected draft | approved, got running',
  });
  for (const error of [new compatibility.GitError('failed'), new compatibility.WorktreeError('blocked'),
    new compatibility.PlanStateError('draft', 'running'), new runtime.EngineNotFoundError('fixture'),
    new runtime.EngineTimeoutError('fixture', 1000)]) {
    expect(error).toBeInstanceOf(kernel.AgonError);
  }
});

it('loads common configuration, Git and plan hosts without the Forge package', async () => {
  vi.doMock('@kernlang/agon-mod-forge', () => { throw new Error('fixture Forge package unavailable'); });
  vi.resetModules();
  try {
    const config = await import('../../packages/core/src/signals/config.js');
    const git = await import('../../packages/core/src/blocks/git.js');
    const plan = await import('../../packages/core/src/blocks/plan.js');
    expect(config.loadConfig).toBeTypeOf('function');
    expect(git.repoRoot).toBeTypeOf('function');
    expect(plan.approvePlan).toBeTypeOf('function');
    await expect(import('@kernlang/agon-mod-forge'))
      .rejects.toMatchObject({ cause: { message: 'fixture Forge package unavailable' } });
  } finally {
    vi.doUnmock('@kernlang/agon-mod-forge');
    vi.resetModules();
  }
});

describe('EngineNotFoundError (mode vs engine, #2)', () => {
  it('hints that a known mode name is a command, not an engine', () => {
    const e = new EngineNotFoundError('conquer');
    expect(e.message).toContain('"conquer" not found');
    expect(e.message).toContain('is an Agon mode');
    expect(e.message).toContain('/conquer');
    expect(e.engineId).toBe('conquer');
  });

  it('recognizes mode names case-insensitively (title-case / upper-case)', () => {
    for (const id of ['Conquer', 'GOAL', 'Forge']) {
      const e = new EngineNotFoundError(id);
      expect(e.message).toContain('is an Agon mode');
      expect(e.message).toContain('/' + id.toLowerCase()); // hint uses the normalized command
      expect(e.message).toContain(`"${id}" not found`); // original casing preserved in the main text
    }
  });

  it('does not add a mode hint for a genuine unknown engine', () => {
    const e = new EngineNotFoundError('totally-unknown-engine');
    expect(e.message).toContain('"totally-unknown-engine" not found');
    expect(e.message).not.toContain('is an Agon mode');
  });

  it('still appends an install hint (not a mode hint) for a non-mode id', () => {
    const e = new EngineNotFoundError('aider', 'pip install aider');
    expect(e.message).toContain('Install: pip install aider');
    expect(e.message).not.toContain('is an Agon mode');
  });

  it('reports a missing binary by name with an install hint (the codex incident)', () => {
    const e = new EngineNotFoundError('codex', 'npm install -g @openai/codex', 'codex');
    expect(e.message).toContain('"codex" not found');
    expect(e.message).toContain('binary "codex" not found on PATH');
    expect(e.message).toContain('Install: npm install -g @openai/codex');
    // It must NOT look like an API-key / env problem.
    expect(e.message).not.toContain('API key');
    expect(e.message).not.toContain('environment variable');
    expect(e.missingBinary).toBe('codex');
  });

  it('names the missing binary even with no install hint', () => {
    const e = new EngineNotFoundError('mycli', undefined, 'mycli-bin');
    expect(e.message).toContain('binary "mycli-bin" not found on PATH');
    expect(e.message).not.toContain('Install:');
  });

  it('a mode-name id still takes priority over a binary hint', () => {
    const e = new EngineNotFoundError('forge', 'irrelevant', 'forge-bin');
    expect(e.message).toContain('is an Agon mode');
    expect(e.message).not.toContain('binary "forge-bin"');
  });
});
