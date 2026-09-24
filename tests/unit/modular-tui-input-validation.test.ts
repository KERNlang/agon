import { beforeEach, describe, expect, it, vi } from 'vitest';

const run = vi.fn();
const contribution = {
  id: 'external-count',
  aliases: [],
  description: 'count',
  inputSchema: {
    type: 'object',
    required: ['count'],
    properties: { count: { type: 'integer', minimum: 1 } },
    additionalProperties: false,
  },
  parse: vi.fn(async () => ({ count: 'not-an-integer' })),
  run,
};

vi.mock('../../packages/cli/src/surface-authority-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/cli/src/surface-authority-runtime.js')>();
  return {
    ...actual,
    modularHostRoot: () => '/tmp/unused-modular-host',
    processSurfaceClient: () => ({ assertAvailable: () => ({ payload: contribution }) }),
  };
});

import { dispatchSessionInfoIntent } from '../../packages/cli/src/signals/dispatch/intent-session.js';

describe('external TUI contribution input validation', () => {
  beforeEach(() => { run.mockClear(); contribution.parse.mockClear(); });

  it('rejects parsed input that violates the contribution schema before invoking code', async () => {
    const dispatch = vi.fn();
    const result = await dispatchSessionInfoIntent(
      { type: 'mod-surface-command', commandName: 'external-count', args: 'bad' },
      '/external-count bad',
      { dispatch, ctx: { config: {} }, eventBus: undefined } as any,
    );

    expect(result).toEqual({ handled: true, ranAsJob: false });
    expect(contribution.parse).toHaveBeenCalledWith('bad');
    expect(run).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('external contribution input does not match its schema'),
    }));
  });
});
