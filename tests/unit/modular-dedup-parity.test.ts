import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ spawn: vi.fn(), resolveDedupSidecar: vi.fn(), resolveSidecarPython: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: effects.spawn }));
vi.mock('@kernlang/agon-core', () => effects);
vi.mock('../../packages/support-dedup/src/dedup-resolver.js', () => effects);
import { dedupBrainstormDrafts as legacy } from '../fixtures/modular-dedup-legacy.js';
import { dedupBrainstormDrafts as current } from '../../packages/support-dedup/src/brainstorm-dedup.js';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

const scenarios = ['empty', 'single', 'missing', 'spawn-throw', 'spawn-error', 'success',
  'invalid-json', 'malformed-groups', 'missing-groups', 'unavailable', 'failed',
  'timeout', 'abort', 'already-aborted', 'late-close', 'stdin-throw'] as const;

it.each(scenarios)('preserves raw dedup result and child-process effects: %s', async scenario => {
  vi.useFakeTimers();
  async function execute(run: typeof legacy) {
    effects.resolveDedupSidecar.mockReturnValue(scenario === 'missing' ? null : '/fixture/sidecar.py');
    effects.resolveSidecarPython.mockReturnValue('/fixture/python');
    const calls: unknown[] = [];
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(),
      stdin: {
        write: (value: string) => { calls.push(['write', value]); if (scenario === 'stdin-throw') throw new Error('EPIPE'); },
        end: () => { calls.push(['end']); },
      },
      kill: (signal: string) => { calls.push(['kill', signal]); return true; },
    });
    effects.spawn.mockImplementation((...args) => {
      calls.push(['spawn', ...args]);
      if (scenario === 'spawn-throw') throw new Error('fixture spawn error');
      return child;
    });
    const controller = new AbortController();
    if (scenario === 'already-aborted') controller.abort();
    const drafts = [{ engineId: 'a', text: 'first\\nline' }, { engineId: 'b', text: 'second' }];
    const pending = run(scenario === 'empty' ? [] : scenario === 'single' ? drafts.slice(0, 1) : drafts,
      { timeoutMs: 40, signal: controller.signal }).then(result => ({ result }), error => ({ error: error.message }));
    if (scenario === 'abort') controller.abort();
    else if (scenario === 'spawn-error') child.emit('error', new Error('fixture async spawn error'));
    else if (!['empty', 'single', 'missing', 'spawn-throw', 'already-aborted', 'timeout'].includes(scenario)) {
      const raw = scenario === 'invalid-json' ? '{' : scenario === 'malformed-groups' ? '{"groups":{}}'
        : scenario === 'missing-groups' ? '{}' : '{"groups":[{"members":["a","b"],"representative":"a","similarity":0.9}]}';
      child.stdout.emit('data', Buffer.from(raw.slice(0, 3)));
      child.stdout.emit('data', Buffer.from(raw.slice(3)));
      child.stderr.emit('data', Buffer.from('fixture failure\\nsecond line'));
      child.emit('close', scenario === 'unavailable' ? 2 : scenario === 'failed' ? 1 : 0);
    }
    await vi.advanceTimersByTimeAsync(40);
    if (scenario === 'late-close') child.emit('close', 1);
    const outcome = await pending;
    await vi.advanceTimersByTimeAsync(250);
    return { outcome, calls, timers: vi.getTimerCount() };
  }
  const expected = await execute(legacy);
  expect(await execute(current)).toEqual(expected);
  expect(expected.timers).toBe(0);
  if (scenario === 'timeout') expect(expected.outcome).toMatchObject({ result: { status: { status: 'timed-out' } } });
  if (scenario === 'abort' || scenario === 'already-aborted') expect(expected.outcome).toEqual({ error: 'Brainstorm deduplication aborted.' });
  if (scenario === 'success') expect(expected.outcome).toMatchObject({ result: { status: { status: 'applied' } } });
});
