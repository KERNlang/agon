import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const spawnSyncMock = vi.hoisted(() => vi.fn());
// Spread the real module: blocks/review pulls in the whole core barrel, which
// legitimately uses execSync/spawn — only spawnSync is intercepted here.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: spawnSyncMock };
});

import { handleReviewAction } from '../../packages/cli/src/blocks/review.js';

const savedEnv = { EDITOR: process.env.EDITOR, VISUAL: process.env.VISUAL };

const review = { winnerId: 'codex', patchPath: '/tmp/agon-review.patch', patchContent: '' };

beforeEach(() => {
  spawnSyncMock.mockReset();
  delete process.env.EDITOR;
  delete process.env.VISUAL;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function openEditor(): string[] {
  const dispatch = vi.fn();
  const undo = handleReviewAction({ type: 'edit' }, review, dispatch);
  expect(undo).toBeNull();
  expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  const [cmd, args] = spawnSyncMock.mock.calls[0];
  expect(args).toEqual([review.patchPath]);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', message: expect.stringContaining(cmd) }));
  return [cmd];
}

// EDITOR and VISUAL are INDEPENDENT: either one alone must open the user's
// editor. Requiring both present drops the user into `vi` on a machine that
// only exports EDITOR — the common case.
describe('handleReviewAction — edit', () => {
  it('opens $EDITOR when only EDITOR is set', () => {
    process.env.EDITOR = 'agon-test-editor';

    expect(openEditor()).toEqual(['agon-test-editor']);
  });

  it('falls back to $VISUAL when only VISUAL is set', () => {
    process.env.VISUAL = 'agon-test-visual';

    expect(openEditor()).toEqual(['agon-test-visual']);
  });

  it('prefers EDITOR over VISUAL when both are set', () => {
    process.env.EDITOR = 'agon-test-editor';
    process.env.VISUAL = 'agon-test-visual';

    expect(openEditor()).toEqual(['agon-test-editor']);
  });

  it('falls back to vi when neither is set', () => {
    expect(openEditor()).toEqual(['vi']);
  });

  it('reports an editor failure instead of throwing', () => {
    process.env.EDITOR = 'agon-test-editor';
    spawnSyncMock.mockImplementation(() => { throw new Error('spawn failed'); });
    const dispatch = vi.fn();

    expect(handleReviewAction({ type: 'edit' }, review, dispatch)).toBeNull();
    expect(dispatch).toHaveBeenCalledWith({ type: 'error', message: 'Editor failed: spawn failed' });
  });
});

describe('handleReviewAction — reject', () => {
  it('never touches the editor', () => {
    const dispatch = vi.fn();

    expect(handleReviewAction({ type: 'reject' }, review, dispatch)).toBeNull();
    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: 'info', message: 'Patch rejected.' });
  });
});
