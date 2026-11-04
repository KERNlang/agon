import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runDelegate as runOwnedDelegate } from '../../packages/mod-forge/src/delegate.js';
import { runDelegate } from '../../packages/forge/src/delegate.js';
import type { DispatchResult } from '@kernlang/agon-support-engine-runtime';
import { setSessionRoot, _resetSessionRootForTests } from '@kernlang/agon-core';

const usage: NonNullable<DispatchResult['usage']> = {
  promptTokens: 3, completionTokens: 5, totalTokens: 8, source: 'sdk',
};
const output = (stdout: string): DispatchResult => ({
  exitCode: 0, stdout, stderr: '', timedOut: false, durationMs: 1, usage,
});
const options = { engineId: 'fixture', task: 'bounded task', cwd: '/fixture/worktree', timeout: 23, outputDir: '/fixture/run' };

describe('Delegate workflow owner', () => {
  it.each([
    ['', ''], [' \n\t ', ''], [' Answer ', 'Answer'],
    ['<THINK>hidden\nreasoning</THINK>\nAnswer', 'Answer'],
    ['<think>one</think> A <think>two</think> B', 'A B'],
    ['<think>unfinished', '<think>unfinished'],
  ])('preserves response cleaning and usage for %j', async (stdout, response) => {
    const dispatch = vi.fn().mockResolvedValue(output(stdout));
    const result = await runOwnedDelegate(options, dispatch);
    expect(result).toEqual({ engineId: 'fixture', response, usage });
    expect(result.usage).toBe(usage);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('forwards explicit execution boundaries and defaults only the mode', async () => {
    const controller = new AbortController();
    const dispatch = vi.fn().mockResolvedValue(output('ok'));
    await runOwnedDelegate({ ...options, signal: controller.signal }, dispatch);
    expect(dispatch).toHaveBeenLastCalledWith({
      prompt: options.task, cwd: options.cwd, mode: 'exec', timeout: 23,
      outputDir: options.outputDir, signal: controller.signal,
    });
    await runOwnedDelegate({ ...options, mode: 'review', signal: controller.signal }, dispatch);
    expect(dispatch.mock.calls[1][0].mode).toBe('review');
  });

  it('does not translate dispatch rejection into a successful response', async () => {
    const error = new Error('fixture dispatch failure');
    await expect(runOwnedDelegate(options, async () => { throw error; })).rejects.toBe(error);
  });

  it('keeps the public legacy facade bound to its registry, adapter and cwd', async () => {
    const engine = { id: 'fixture' };
    const get = vi.fn().mockReturnValue(engine);
    const dispatch = vi.fn().mockResolvedValue(output('<think>hidden</think>answer'));
    const controller = new AbortController();
    type Legacy = Parameters<typeof runDelegate>[0];
    const result = await runDelegate({
      ...options, signal: controller.signal,
      registry: { get } as unknown as Legacy['registry'],
      adapter: { dispatch } as unknown as Legacy['adapter'],
    });
    expect(get).toHaveBeenCalledWith('fixture');
    expect(dispatch).toHaveBeenCalledWith({
      engine, prompt: options.task, cwd: options.cwd, mode: 'exec', timeout: 23,
      outputDir: options.outputDir, signal: controller.signal,
    });
    expect(result).toEqual({ engineId: 'fixture', response: 'answer', usage });
  });

  it('propagates registry failure without dispatch', async () => {
    const error = new Error('fixture missing engine');
    const dispatch = vi.fn();
    type Legacy = Parameters<typeof runDelegate>[0];
    await expect(runDelegate({
      ...options,
      registry: { get: () => { throw error; } } as unknown as Legacy['registry'],
      adapter: { dispatch } as unknown as Legacy['adapter'],
    })).rejects.toBe(error);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('uses the session workspace only when the caller omits cwd', async () => {
    const dispatch = vi.fn().mockResolvedValue(output('ok'));
    type Legacy = Parameters<typeof runDelegate>[0];
    setSessionRoot('/fixture/session-root');
    try {
      const base = {
        ...options,
        registry: { get: () => ({ id: 'fixture' }) } as unknown as Legacy['registry'],
        adapter: { dispatch } as unknown as Legacy['adapter'],
      };
      await runDelegate({ ...base, cwd: undefined });
      expect(dispatch.mock.calls[0][0].cwd).toBe('/fixture/session-root');
      await runDelegate(base);
      expect(dispatch.mock.calls[1][0].cwd).toBe('/fixture/worktree');
    } finally {
      _resetSessionRootForTests();
    }
  });

  it('passes cancellation to the facade adapter and preserves its rejection', async () => {
    const controller = new AbortController();
    const error = new DOMException('fixture cancelled', 'AbortError');
    const dispatch = vi.fn(({ signal }) => new Promise<DispatchResult>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(error), { once: true });
    }));
    type Legacy = Parameters<typeof runDelegate>[0];
    const running = runDelegate({
      ...options, signal: controller.signal,
      registry: { get: () => ({ id: 'fixture' }) } as unknown as Legacy['registry'],
      adapter: { dispatch } as unknown as Legacy['adapter'],
    });
    const rejected = expect(running).rejects.toBe(error);
    expect(dispatch).toHaveBeenCalledOnce();
    controller.abort();
    await rejected;
  });

  it('retains historical output and absent usage even on a nonzero dispatch exit', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ...output('partial answer'), usage: undefined, exitCode: 1 });
    expect(await runOwnedDelegate(options, dispatch)).toEqual({
      engineId: 'fixture', response: 'partial answer', usage: undefined,
    });
  });

  it('retains no legacy result declaration or response-cleaning implementation', () => {
    const source = readFileSync(new URL('../../packages/forge/src/delegate.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/interface\s+DelegateResult|\.replace\(|\.trim\(/);
    expect(source).toContain('runOwnedDelegate(');
    expect(source).toContain("export type { DelegateResult } from '@kernlang/agon-mod-forge'");
  });
});
