import { afterEach, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../packages/core/src/models/tool-types.js';
import { executeToolCall, executeToolCalls, ToolRegistry } from '../../packages/core/src/signals/tool-registry.js';

const hooks = vi.hoisted(() => ({ pre: vi.fn(), post: vi.fn() }));
vi.mock('../../packages/core/src/tools/tool-hooks.js', () => ({
  hasToolHooks: (value: unknown) => Boolean(value),
  runPreToolUseHooks: hooks.pre,
  runPostToolUseHooks: hooks.post,
}));
afterEach(() => vi.resetAllMocks());

it.each(['authority', 'permission', 'hook'].flatMap(boundary =>
  ['cancelled', 'refused', 'empty-refusal', 'broken-check', 'healthy'].map(state => [boundary, state]),
))('rechecks health after %s awaits (%s)', async (boundary, state) => {
  let release!: () => void;
  let entered!: () => void;
  const suspended = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const wait = async () => { entered(); await pending; return true; };
  const abort = new AbortController();
  let unhealthy = false;
  const execute = vi.fn(async () => ({ ok: true, content: 'executed' }));
  const registry = new ToolRegistry();
  registry.register({
    definition: { name: 'Fixture', description: 'No external effects', inputSchema: {},
      isReadOnly: false, isConcurrencySafe: false, maxResultSizeChars: 100 },
    validate: () => null,
    checkPermission: () => ({ behavior: boundary === 'permission' ? 'ask' : 'allow' }),
    execute,
  });
  hooks.pre.mockImplementation(async () => { await wait(); return { block: false }; });
  const ctx: ToolContext = {
    cwd: process.cwd(), readFileState: new Map(), abortSignal: abort.signal,
    executionRefusal: () => {
      if (!unhealthy) return undefined;
      if (state === 'broken-check') throw new Error('internal details');
      if (state === 'empty-refusal') return '';
      return 'Session no longer usable';
    },
    ...(boundary === 'authority' ? { authorizeToolCall: wait } : {}),
    // Always configure hooks, so early refusals must also prevent hook effects.
    toolHooks: { preToolUse: [{ command: 'not executed: mocked' }], postToolUse: [] },
  };
  if (boundary !== 'hook') hooks.pre.mockResolvedValue({ block: false });
  const resultPromise = executeToolCall({ id: 'fixture', name: 'Fixture', input: {} }, ctx, registry, wait);
  await suspended;
  release();
  if (state === 'cancelled') abort.abort();
  else if (state !== 'healthy') unhealthy = true;
  const result = await resultPromise;
  if (state === 'healthy') {
    expect(result.result.ok).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(hooks.post).toHaveBeenCalledOnce();
  } else {
    expect(result.result.ok).toBe(false);
    expect(result.result.error).toBeTruthy();
    expect(result.result.terminalReason).toBe(state === 'cancelled' ? 'cancelled' : 'denied');
    expect(execute).not.toHaveBeenCalled();
    expect(hooks.post).not.toHaveBeenCalled();
    if (boundary !== 'hook') expect(hooks.pre).not.toHaveBeenCalled();
    if (state === 'broken-check') expect(result.result.error).not.toContain('internal details');
  }
});

it.each(['cancelled', 'refused', 'broken-check', 'healthy'])(
  'preserves completed tool work but guards post-hooks: %s', async state => {
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const abort = new AbortController();
    let unhealthy = false;
    const registry = new ToolRegistry();
    registry.register({
      definition: { name: 'Fixture', description: 'Controlled completion', inputSchema: {},
        isReadOnly: false, isConcurrencySafe: false, maxResultSizeChars: 100 },
      validate: () => null,
      checkPermission: () => ({ behavior: 'allow' }),
      execute: async () => { entered(); await pending; return { ok: true, content: 'completed work' }; },
    });
    hooks.pre.mockResolvedValue({ block: false });
    const resultPromise = executeToolCall({ id: 'fixture', name: 'Fixture', input: {} }, {
      cwd: process.cwd(), readFileState: new Map(), abortSignal: abort.signal,
      executionRefusal: () => {
        if (!unhealthy) return undefined;
        if (state === 'broken-check') throw new Error('private detail');
        return 'Owner disabled';
      },
      toolHooks: { preToolUse: [], postToolUse: [{ command: 'not executed: mocked' }] },
    }, registry);
    await started;
    if (state === 'cancelled') abort.abort();
    else if (state !== 'healthy') unhealthy = true;
    release();
    expect((await resultPromise).result).toMatchObject({ ok: true, content: 'completed work', terminalReason: 'succeeded' });
    expect(hooks.post).toHaveBeenCalledTimes(state === 'healthy' ? 1 : 0);
  },
);

it('retains every serial result and prevents later calls after revocation', async () => {
  let refused = false;
  const execute = vi.fn(async () => { refused = true; return { ok: true, content: 'first completed' }; });
  const validate = vi.fn(() => null);
  const registry = new ToolRegistry();
  registry.register({
    definition: { name: 'Fixture', description: 'Revokes after one call', inputSchema: {},
      isReadOnly: false, isConcurrencySafe: false, maxResultSizeChars: 100 },
    validate, checkPermission: () => ({ behavior: 'allow' }), execute,
  });
  const results = await executeToolCalls(['one', 'two', 'three'].map(id => ({ id, name: 'Fixture', input: {} })), {
    cwd: process.cwd(), readFileState: new Map(),
    executionRefusal: () => refused ? 'Owner disabled' : undefined,
  }, registry);
  expect(results.map(result => [result.toolCallId, result.result.terminalReason])).toEqual([
    ['one', 'succeeded'], ['two', 'denied'], ['three', 'denied'],
  ]);
  expect(validate).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledOnce();
});

it('classifies simultaneous refusal and abort as cancellation without executing', async () => {
  const abort = new AbortController();
  abort.abort();
  const execute = vi.fn(async () => ({ ok: true, content: 'unexpected' }));
  const registry = new ToolRegistry();
  registry.register({
    definition: { name: 'Fixture', description: 'No effects permitted', inputSchema: {},
      isReadOnly: false, isConcurrencySafe: false, maxResultSizeChars: 100 },
    validate: () => null, checkPermission: () => ({ behavior: 'allow' }), execute,
  });
  const result = await executeToolCall({ id: 'fixture', name: 'Fixture', input: {} }, {
    cwd: process.cwd(), readFileState: new Map(), abortSignal: abort.signal,
    executionRefusal: () => 'Owner disabled',
  }, registry);
  expect(result.result).toMatchObject({ ok: false, terminalReason: 'cancelled', error: 'Owner disabled' });
  expect(execute).not.toHaveBeenCalled();
});
