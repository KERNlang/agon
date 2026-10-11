import { beforeEach, expect, it, vi } from 'vitest';
import type { BrainstormResult } from '@kernlang/agon-mod-brainstorm';
import { selectModSettings } from '../../packages/mod-kernel/src/mod-settings.js';
const mocks = vi.hoisted(() => ({ create: vi.fn(), complete: vi.fn(), fail: vi.fn(), scan: vi.fn(), available: vi.fn() }));
vi.mock('@kernlang/agon-core', async importOriginal => ({ ...await importOriginal<object>(), scanProjectContext: mocks.scan }));
vi.mock('@kernlang/agon-mod-brainstorm', async original => ({ ...await original<object>(), createBrainstormSessionRecord: mocks.create }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => ({
  ...await original<object>(), processSurfaceClient: () => ({ assertAvailable: mocks.available }),
}));
import { dispatchSessionInfoIntent, runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockReturnValue({ complete: mocks.complete, fail: mocks.fail });
});
const result: BrainstormResult = { question: 'Question', winner: 'fixture', response: 'readable answer', bids: [
  { engineId: 'fixture', reasoning: 'why', approach: 'how', score: 71, confidence: 80 },
] };
const callbacks = () => ({ dispatch: vi.fn(), ctx: { config: {}, activeEngines: () => ['fixture'], chatSession: { id: 'session' } } });
const record = (run: ReturnType<typeof vi.fn>, owner = 'agon.brainstorm') => ({ owner: { id: owner }, payload: {
  inputSchema: { type: 'object', required: ['question'], properties: { question: { type: 'string' } } }, run,
} });

it('uses the selected TUI contribution with session context and the real Brainstorm presenter', async () => {
  const cb = callbacks();
  const signal = new AbortController().signal;
  mocks.scan.mockReturnValue('fixture project context');
  const run = vi.fn(async (_input, context) => {
    context.onWorkflowEvent?.({ type: 'brainstorm:seat-started', data: { engineId: 'fixture' } });
    return { exitCode: 0, result, stdout: JSON.stringify(result) };
  });
  await runPhysicalTuiContribution(record(run), { question: 'Question' }, 'brainstorm', cb as never, signal);
  expect(run).toHaveBeenCalledExactlyOnceWith({ question: 'Question', engines: ['fixture'], context: 'fixture project context' }, expect.objectContaining({ signal }));
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(result);
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'kern-draft' }));
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block', content: 'readable answer' }));
  expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ message: JSON.stringify(result) }));
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
});

it('rejects late success after cancellation and clears progress', async () => {
  const cb = callbacks();
  const controller = new AbortController();
  const run = vi.fn(async () => { controller.abort(new Error('cancelled')); return { exitCode: 0, result }; });
  await expect(runPhysicalTuiContribution(record(run), { question: 'Question' }, 'brainstorm', cb as never, controller.signal)).rejects.toThrow('cancelled');
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.fail).toHaveBeenCalledOnce();
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
});

it('does not apply first-party presentation based only on a command name', async () => {
  const cb = callbacks();
  const run = vi.fn(async () => ({ exitCode: 0, stdout: 'external output' }));
  await runPhysicalTuiContribution(record(run, 'external.fixture'), { question: 'Question' }, 'brainstorm', cb as never, new AbortController().signal);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledWith({ question: 'Question' }, expect.anything());
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: 'external output' });
});

it('passes only the invoked owner settings and protects the host snapshot', async () => {
  const cb = callbacks();
  const settings = { nested: { label: 'selected' }, choices: ['one'] };
  cb.ctx.config = { hostPrivate: 'not-for-mods', mods: {
    'external.fixture': settings, 'external.other': { private: 'other owner' },
  } };
  const run = vi.fn(async (_input, context) => {
    expect(context.config).toEqual(settings);
    expect(context.config).not.toBe(settings);
    expect(Object.isFrozen(context.config.nested)).toBe(true);
    expect(Object.isFrozen(context.config.choices)).toBe(true);
    expect(() => { context.config.nested.label = 'changed'; }).toThrow();
    return { exitCode: 0 };
  });
  await runPhysicalTuiContribution(record(run, 'external.fixture'), { question: 'Question' }, 'brainstorm', cb as never, new AbortController().signal);
  expect(run).toHaveBeenCalledOnce();
  expect(settings.nested.label).toBe('selected');
});

it.each([undefined, 'external.absent'])('does not expose host config when owner %s has no settings', async owner => {
  const cb = callbacks();
  cb.ctx.config = { hostPrivate: 'not-for-mods', mods: { 'external.other': { private: true } } };
  const run = vi.fn(async (_input, context) => {
    expect(context.config).toEqual({});
    return { exitCode: 0 };
  });
  const contribution = record(run, 'external.fixture');
  await runPhysicalTuiContribution({ ...contribution, owner: owner ? { id: owner } : undefined }, { question: 'Question' }, 'brainstorm', cb as never, new AbortController().signal);
  expect(run).toHaveBeenCalledOnce();
});

it.each([null, [], 'bad'])('rejects a malformed owner namespace before execution: %j', async value => {
  const cb = callbacks();
  cb.ctx.config = { mods: { 'external.fixture': value } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  await expect(runPhysicalTuiContribution(record(run, 'external.fixture'), { question: 'Question' }, 'brainstorm', cb as never, new AbortController().signal)).rejects.toThrow(/mod settings/);
  expect(run).not.toHaveBeenCalled();
});

it('scopes settings in the generic slash-command dispatch path too', async () => {
  const cb = callbacks();
  cb.ctx.config = { hostPrivate: 'not-for-mods', mods: { 'external.fixture': { label: 'selected' } } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  mocks.available.mockReturnValue({ owner: { id: 'external.fixture' }, payload: { inputSchema: { type: 'object' }, run } });
  await dispatchSessionInfoIntent({ type: 'mod-surface-command', commandName: 'fixture' }, '', cb as never);
  expect(run).toHaveBeenCalledWith({ input: '' }, expect.objectContaining({ config: { label: 'selected' } }));
  expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
});

it('rejects non-JSON and dangerous settings without traversing other owners', () => {
  const invalid = [() => undefined, Number.NaN, new Date(), JSON.parse('{"__proto__":{}}')];
  for (const value of invalid) {
    expect(() => selectModSettings({ mods: { fixture: { value } } }, 'fixture')).toThrow(/mod settings/);
  }
  expect(selectModSettings({ mods: { fixture: { enabled: false, count: 0, optional: null }, other: invalid } }, 'fixture'))
    .toEqual({ enabled: false, count: 0, optional: null });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expect(() => selectModSettings({ mods: { fixture: cycle } }, 'fixture')).toThrow(/maximum depth/);
  expect(() => selectModSettings({ mods: [] }, 'fixture')).toThrow(/namespaces/);
});

it('copies own array elements without calling input methods or accepting holes', () => {
  const nested = { label: 'host' };
  const items = [nested];
  const overriddenMap = vi.fn(() => items);
  Object.defineProperty(items, 'map', { value: overriddenMap });
  const result = selectModSettings({ mods: { fixture: { items } } }, 'fixture');
  expect(overriddenMap).not.toHaveBeenCalled();
  expect(result.items).toEqual([{ label: 'host' }]);
  expect(result.items).not.toBe(items);
  expect(Object.isFrozen(items)).toBe(false);
  nested.label = 'host edited';
  expect(result.items).toEqual([{ label: 'host' }]);
  const sparse = new Array(1);
  expect(() => selectModSettings({ mods: { fixture: { sparse } } }, 'fixture')).toThrow(/array/);
  const inherited = new Array(1);
  Object.setPrototypeOf(inherited, { 0: { label: 'inherited' }, map: Array.prototype.map });
  expect(() => selectModSettings({ mods: { fixture: { inherited } } }, 'fixture')).toThrow(/array/);
});

it.each([undefined, 'external.absent'])('generic dispatch gives owner %s no host fallback', async owner => {
  const cb = callbacks();
  cb.ctx.config = { hostPrivate: 'not-for-mods', mods: { 'external.other': { value: 'other' } } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  mocks.available.mockReturnValue({ owner: owner ? { id: owner } : undefined, payload: { inputSchema: { type: 'object' }, run } });
  await dispatchSessionInfoIntent({ type: 'mod-surface-command', commandName: 'fixture' }, '', cb as never);
  expect(run).toHaveBeenCalledExactlyOnceWith({ input: '' }, expect.objectContaining({ config: {} }));
});

it.each([null, [], 'bad'])('generic dispatch reports malformed owner settings: %j', async value => {
  const cb = callbacks();
  cb.ctx.config = { mods: { 'external.fixture': value } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  mocks.available.mockReturnValue({ owner: { id: 'external.fixture' }, payload: { inputSchema: { type: 'object' }, run } });
  await dispatchSessionInfoIntent({ type: 'mod-surface-command', commandName: 'fixture' }, '', cb as never);
  expect(run).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'error', message: expect.stringContaining('mod settings') });
});

it('keeps host scanning configuration separate from Brainstorm mod settings', async () => {
  const cb = callbacks();
  cb.ctx.config = { projectContext: 'host context', contextFormat: 'xml', mods: { 'agon.brainstorm': { label: 'owner' } } };
  mocks.scan.mockReturnValue('scanned context');
  const run = vi.fn(async (_input, invocation) => {
    expect(invocation.config).toEqual({ label: 'owner' });
    return { exitCode: 0, result };
  });
  await runPhysicalTuiContribution(record(run), { question: 'Question' }, 'brainstorm', cb as never, new AbortController().signal);
  expect(run).toHaveBeenCalledOnce();
  expect(mocks.scan).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'host context', 'xml');
});
