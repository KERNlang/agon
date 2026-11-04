import { afterEach, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ apply: vi.fn(() => ({ ok: true, undoToken: 'owned-token' })) }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(),
  resolveWorkingDir: () => '/fixture',
  applyPatchWithUndo: () => { throw new Error('Legacy core patch binding must not run'); },
}));
vi.mock('@kernlang/agon-support-worktree', async original => ({
  ...await original<Record<string, unknown>>(), applyPatchWithUndo: effects.apply,
}));
import { handleReviewAction } from '../../packages/cli/src/blocks/review.js';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('injects the current persistence location into the physical patch owner', () => {
  for (const home of ['/fixture/first', '/fixture/second']) {
    vi.stubEnv('AGON_HOME', `  ${home}  `);
    expect(handleReviewAction({ type: 'apply' }, {
      winnerId: 'fixture', patchPath: '/unused', patchContent: 'fixture patch',
    }, vi.fn())).toBe('owned-token');
    expect(effects.apply).toHaveBeenLastCalledWith('/fixture', 'fixture patch', `${home}/undo`);
  }
  expect(effects.apply).toHaveBeenCalledTimes(2);
});
