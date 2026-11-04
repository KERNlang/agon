import { expect, it, vi } from 'vitest';
import { runSynthesisModus } from '../../packages/forge/src/synthesis-modus.js';

it.each(['before', 'during'])('stops the legacy runtime after cancellation: %s', async phase => {
  const controller = new AbortController();
  const dispatch = vi.fn(async () => {
    controller.abort(new Error('runtime cancelled'));
    return { exitCode: 0, stdout: 'late draft', stderr: '', timedOut: false };
  });
  const registry = { get: (id: string) => ({ id }), findBinary: () => process.execPath };
  if (phase === 'before') controller.abort(new Error('runtime cancelled'));
  await expect(runSynthesisModus({ prompt: 'Design', engines: ['alpha', 'beta'],
    registry: registry as never, adapter: { dispatch } as never, swaps: 2,
    timeout: 5, outputDir: process.env.TMPDIR!, signal: controller.signal }))
    .rejects.toThrow('runtime cancelled');
  if (phase === 'before') expect(dispatch).not.toHaveBeenCalled();
  else expect(dispatch.mock.calls.length).toBeLessThanOrEqual(2);
});
