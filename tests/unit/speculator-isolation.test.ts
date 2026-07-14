import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runApiAgentLoop: vi.fn(),
  worktreeCreate: vi.fn(async () => { throw new Error('worktree unavailable'); }),
}));

vi.mock('../../packages/core/src/generated/api/agent-loop.js', () => ({
  runApiAgentLoop: mocks.runApiAgentLoop,
}));

vi.mock('../../packages/core/src/generated/blocks/git.js', async () => {
  const actual = await vi.importActual<typeof import('../../packages/core/src/generated/blocks/git.js')>(
    '../../packages/core/src/generated/blocks/git.js',
  );
  return { ...actual, worktreeCreate: mocks.worktreeCreate };
});

import { Speculator } from '../../packages/core/src/generated/cesar/speculator.js';

describe('Speculator isolation fail-closed behavior', () => {
  it('does not dispatch an isolated member in the shared cwd when worktree creation fails', async () => {
    const result = await new Speculator().run({
      cwd: process.cwd(),
      prompt: 'edit files',
      isolate: true,
      members: [{
        engineId: 'unsafe-fallback',
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'TEST_KEY', model: 'test' },
      }],
    });

    expect(mocks.runApiAgentLoop).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(expect.objectContaining({
      engineId: 'unsafe-fallback',
      response: expect.stringContaining('isolated worktree unavailable'),
      effects: [],
    }));
    expect(result.scores['unsafe-fallback']).toBe(0);
    expect(result.winnerId).toBeNull();
  });
});
