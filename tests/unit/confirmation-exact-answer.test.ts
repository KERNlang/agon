import { beforeEach, expect, it, vi } from 'vitest';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const effects = vi.hoisted(() => ({ spawn: vi.fn(), chat: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(), spawnWithTimeout: effects.spawn,
}));
vi.mock('../../packages/cli/src/handlers/index.js', () => ({
  handleChat: effects.chat, handleForge: vi.fn(), handleBrainstorm: vi.fn(), handleTribunal: vi.fn(),
}));
vi.mock('../../packages/cli/src/signals/dispatch/delegation.js', () => ({
  withThreadOutcome: (_cwd: string, _kind: string, _label: string, run: unknown) => run,
  buildBrainstormContinuationMessage: vi.fn(),
}));
vi.mock('../../packages/cli/src/signals/dispatch/cesar-router.js', () => ({ continueCesarAfterResult: vi.fn() }));
import { handleRun } from '../../packages/cli/src/handlers/run.js';
import { dispatchMetaIntent } from '../../packages/cli/src/signals/dispatch/intent-meta.js';

beforeEach(() => {
  vi.clearAllMocks();
  effects.spawn.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
});

it.each(['yikes', 'yes please', 'yes.', '', 'no', 'y', ' YES '])('shell confirmation requires an exact affirmative: %j', async answer => {
  await handleRun('fixture-command', vi.fn(), { askQuestion: async () => answer } as unknown as HandlerContext);
  expect(effects.spawn).toHaveBeenCalledTimes(['y', ' YES '].includes(answer) ? 1 : 0);
});

it.each(['suggest-brainstorm', 'suggest-tribunal', 'suggest-forge'])('%s requires an exact affirmative', async type => {
  for (const answer of ['yikes', 'yes please', 'yes.', '', 'no', 'y', ' YES ']) {
    const runAsJob = vi.fn();
    const cb = { ctx: {}, dispatch: vi.fn(), askQuestion: async () => answer, runAsJob } as unknown as DispatchCallbacks;
    await dispatchMetaIntent({ type, input: 'fixture', question: 'fixture', task: 'fixture' }, 'fixture', cb);
    expect(runAsJob, answer).toHaveBeenCalledTimes(['y', ' YES '].includes(answer) ? 1 : 0);
  }
});
