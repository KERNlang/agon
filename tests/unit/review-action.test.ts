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
  spawnSyncMock.mockReturnValue({ status: 0, signal: null, error: undefined });
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

// spawnSync reports a launch failure on the RESULT, not by throwing: a missing
// binary comes back as { error: ENOENT, status: null }. Claiming "Opened …"
// then leaves the user waiting on an editor window that will never open.
describe('handleReviewAction — edit failures reported without a throw', () => {
  const messages = (dispatch: ReturnType<typeof vi.fn>) => dispatch.mock.calls.map((c) => c[0]);

  it('reports a missing editor binary (ENOENT) as an error', () => {
    process.env.EDITOR = 'agon-missing-editor';
    spawnSyncMock.mockReturnValue({ error: Object.assign(new Error('spawn agon-missing-editor ENOENT'), { code: 'ENOENT' }), status: null, signal: null });
    const dispatch = vi.fn();

    expect(handleReviewAction({ type: 'edit' }, review, dispatch)).toBeNull();

    expect(messages(dispatch)).toEqual([{ type: 'error', message: 'Editor failed: spawn agon-missing-editor ENOENT' }]);
    expect(messages(dispatch)).not.toContainEqual(expect.objectContaining({ type: 'info' }));
  });

  it('reports a non-zero editor exit code', () => {
    process.env.EDITOR = 'agon-test-editor';
    spawnSyncMock.mockReturnValue({ status: 3, signal: null, error: undefined });
    const dispatch = vi.fn();

    handleReviewAction({ type: 'edit' }, review, dispatch);

    expect(messages(dispatch)).toEqual([{ type: 'error', message: 'Editor agon-test-editor exited with code 3' }]);
  });

  it('reports an editor killed by a signal', () => {
    process.env.EDITOR = 'agon-test-editor';
    spawnSyncMock.mockReturnValue({ status: null, signal: 'SIGKILL', error: undefined });
    const dispatch = vi.fn();

    handleReviewAction({ type: 'edit' }, review, dispatch);

    expect(messages(dispatch)).toEqual([{ type: 'error', message: 'Editor agon-test-editor terminated by SIGKILL' }]);
  });

  it('still confirms a clean editor session', () => {
    process.env.EDITOR = 'agon-test-editor';
    spawnSyncMock.mockReturnValue({ status: 0, signal: null, error: undefined });
    const dispatch = vi.fn();

    handleReviewAction({ type: 'edit' }, review, dispatch);

    expect(messages(dispatch)).toEqual([{ type: 'info', message: `Opened ${review.patchPath} in agon-test-editor` }]);
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
