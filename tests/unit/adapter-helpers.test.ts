import { describe, expect, it } from 'vitest';

import { shouldUseCompanionForAgent, buildCommand, resolveArgs } from '../../packages/adapter-cli/src/generated/adapter-helpers.js';

describe('adapter helper routing', () => {
  it('uses one-shot agent companion only for JSON-RPC engines', () => {
    expect(shouldUseCompanionForAgent({ id: 'codex', companion: { protocol: 'jsonrpc' } } as any)).toBe(true);
    expect(shouldUseCompanionForAgent({ id: 'gemini', companion: { protocol: 'acp' } } as any)).toBe(false);
    expect(shouldUseCompanionForAgent({ id: 'claude', companion: { protocol: 'stream-json' } } as any)).toBe(false);
    expect(shouldUseCompanionForAgent({ id: 'plain' } as any)).toBe(false);
  });
});

describe('cwd templating (worktree isolation)', () => {
  it('resolveArgs substitutes {cwd} with the dispatch directory', () => {
    expect(resolveArgs(['run', '--dir', '{cwd}', '{prompt}'], { cwd: '/wt/x', prompt: 'hi' }))
      .toEqual(['run', '--dir', '/wt/x', 'hi']);
  });

  // Regression: opencode ignores the spawn cwd / attaches to a shared server in
  // the launch repo, so its CLI args MUST carry an explicit --dir <worktree> or
  // engine writes leak into the parent repo (goal --cwd isolation bug).
  it('opencode CLI command pins --dir to the dispatch cwd in every mode', () => {
    const opencode = {
      id: 'opencode',
      agent: { args: ['run', '--dir', '{cwd}', '{prompt}'] },
      exec: { args: ['run', '--dir', '{cwd}', '--format', 'json', '{prompt}'] },
      review: { args: ['run', '--dir', '{cwd}', '--format', 'json', '{prompt}'] },
    } as any;
    for (const mode of ['agent', 'exec', 'review'] as const) {
      const { args } = buildCommand(opencode, mode, 'do it', '/wt/task-7', 180, 'opencode');
      const i = args.indexOf('--dir');
      expect(i).toBeGreaterThanOrEqual(0);
      expect(args[i + 1]).toBe('/wt/task-7');
    }
  });
});
