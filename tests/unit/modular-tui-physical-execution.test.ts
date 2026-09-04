import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchIntent } from '../../packages/cli/src/signals/dispatch.js';
import { detectIntent } from '../../packages/cli/src/signals/intent.js';
import {
  disposeProcessSurfaceAuthority,
  initializeProcessSurfaceAuthority,
} from '../../packages/cli/src/surface-authority-runtime.js';

let root: string | undefined;

afterEach(async () => {
  await disposeProcessSurfaceAuthority();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('generated TUI physical execution authority', () => {
  it('executes the owner-tagged physical contribution instead of the legacy intent switch', async () => {
    root = await mkdtemp(join(tmpdir(), 'agon-tui-physical-'));
    await initializeProcessSurfaceAuthority(join(root, 'host'));
    const intent = detectIntent('/sanitize already clean');
    expect(intent).toMatchObject({
      type: 'sanitize',
      _modSurface: {
        publicId: 'sanitize',
        registryId: 'tuiSlashCommands:0060',
        kind: 'tui-action',
        value: { text: 'already clean' },
      },
    });

    const dispatch = vi.fn();
    let job: Promise<void> | undefined;
    const result = await dispatchIntent(intent, '/sanitize already clean', {
      dispatch,
      ctx: { config: {} },
      eventBus: undefined,
      runAsJob: (_type: string, _label: string, fn: (signal: AbortSignal) => Promise<void>) => {
        job = fn(new AbortController().signal);
      },
    } as any);

    expect(result).toEqual({ handled: true, ranAsJob: true });
    await job;
    expect(dispatch).toHaveBeenCalledWith({ type: 'info', message: 'already clean' });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'engine-block',
      engineId: 'sanitize',
    }));
  });
});
