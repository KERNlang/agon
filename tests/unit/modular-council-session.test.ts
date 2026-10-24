import { beforeEach, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
const effects = vi.hoisted(() => ({ append: vi.fn(), track: vi.fn(), add: vi.fn(), record: vi.fn(), command: vi.fn() }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => {
  const record = { id: 'tuiSlashCommands:0022', kind: 'intent', owner: { id: 'agon.council' },
    payload: { inputSchema: { type: 'object' }, run: effects.command } };
  return { ...await original<object>(), executeProcessCesarRoute: effects.command,
    processSurfaceClient: () => ({ assertAvailable: () => record, project: () => ({ entries: [record] }) }) };
});
vi.mock('../../packages/cli/src/signals/dispatch/delegation.js', async original => ({
  ...await original<object>(), withThreadOutcome: (_cwd: string, _mode: string, _label: string, run: () => Promise<unknown>) => run,
  collectRecentEngineContext: () => '',
}));
vi.mock('@kernlang/agon-core', async original => {
  const actual = await original<typeof import('@kernlang/agon-core')>();
  return { ...actual, appendMessage: effects.append, tracker: { ...actual.tracker, record: effects.track } };
});
vi.mock('../../packages/cli/src/models/session-results.js', () => ({ sessionResultStore: { add: effects.add } }));
vi.mock('../../packages/cli/src/telemetry/index.js', async original => ({
  ...await original<object>(), recordRun: effects.record, formatRunSummary: () => 'saved summary',
}));
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';
import { dispatchOrchestrationIntent } from '../../packages/cli/src/signals/dispatch/intent-orchestration.js';
import { runPhysicalCesarWorkflow } from '../../packages/cli/src/signals/dispatch/cesar-router.js';
import { dispatchIntent } from '../../packages/cli/src/signals/dispatch/intent-router.js';

beforeEach(() => vi.resetAllMocks());
it('retires the legacy Council session execution owner', () => {
  expect(existsSync(new URL('../../packages/cli/src/handlers/council.ts', import.meta.url))).toBe(false);
  expect(existsSync(new URL('../../packages/cli/src/commands/council.ts', import.meta.url))).toBe(false);
  expect(readFileSync(new URL('../../packages/cli/src/signals/dispatch/intent-orchestration.ts', import.meta.url), 'utf8')).not.toContain('handleCouncil');
});
const result = { ok: true, question: 'Q', brief: 'Brief', chairmanId: 'alpha', actingChairmanId: 'beta',
  seats: [{ engineId: 'beta', role: 'security', response: 'Evidence', critique: '', critiquedRole: '' }],
  verdict: 'Conclusion', confidence: 0, warnings: [] };
function callbacks() { return { dispatch: vi.fn(), ctx: { config: {}, activeEngines: () => ['alpha', 'beta'],
  registry: { resolveId: (id: string) => id, activeIds: () => ['alpha', 'beta'] }, chatSession: { id: 'original' } } }; }
it('propagates a failed generated Council command to its job', async () => {
  const cb = { ...callbacks(), runAsJob: vi.fn() };
  effects.command.mockResolvedValue({ exitCode: 1, stderr: 'Council produced no usable verdict.' });
  await dispatchIntent({ type: 'council', _modSurface: { publicId: 'council', registryId: 'tuiSlashCommands:0022',
    kind: 'intent', value: { question: 'Q' } } }, '/council Q', cb as never);
  expect(cb.runAsJob).toHaveBeenCalledOnce();
  await expect(cb.runAsJob.mock.calls[0][2](new AbortController().signal)).rejects.toThrow('Council produced no usable verdict.');
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.add).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
});
it.each(['normal', 'before', 'during'])('uses the physical Council owner for slash jobs: %s', async cancel => {
  const cb = { ...callbacks(), runAsJob: vi.fn() };
  const controller = new AbortController();
  effects.command.mockImplementation(async () => {
    if (cancel === 'during') controller.abort(new Error('job cancelled'));
    return { exitCode: 0, result };
  });
  await dispatchOrchestrationIntent({ type: 'council', question: 'Q' }, '/council Q', cb as never);
  expect(cb.runAsJob).toHaveBeenCalledOnce();
  if (cancel === 'before') controller.abort(new Error('job cancelled'));
  const pending = cb.runAsJob.mock.calls[0][2](controller.signal);
  if (cancel !== 'normal') {
    await expect(pending).rejects.toThrow('job cancelled');
    expect(effects.append).not.toHaveBeenCalled();
    expect(effects.record).not.toHaveBeenCalled();
  } else {
    await pending;
    expect(effects.command).toHaveBeenCalledWith(expect.objectContaining({ question: 'Q' }), expect.objectContaining({ signal: controller.signal }));
    expect(effects.record).toHaveBeenCalledOnce();
  }
});
it.each(['tui', 'cesar'])('binds owned Council history to the original session and job signal: %s', async surface => {
  const cb = callbacks();
  const original = cb.ctx.chatSession;
  const signal = new AbortController().signal;
  const run = vi.fn(async (_input: unknown, _context: unknown) => { cb.ctx.chatSession = { id: 'new' }; return { exitCode: 0, result }; });
  effects.command.mockImplementation((_route, input, context) => run(input, context));
  if (surface === 'cesar') await runPhysicalCesarWorkflow('council', { question: 'Q', chairman: 'alpha' }, cb as never, signal, '/selected-cwd');
  else await runPhysicalTuiContribution({ owner: { id: 'agon.council' }, payload: { inputSchema: { type: 'object' }, run } },
    { question: 'Q', chairman: 'alpha' }, 'council', cb as never, signal);
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ chairman: 'alpha', engines: 'alpha,beta' }), expect.objectContaining({ signal }));
  expect(effects.append).toHaveBeenCalledTimes(2);
  expect(effects.append).toHaveBeenLastCalledWith(original, expect.objectContaining({ engineId: 'beta', content: '[council:verdict] Conclusion' }));
  expect(effects.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'council', winner: 'beta' }));
  expect(effects.record).toHaveBeenCalledWith(expect.objectContaining({ success: true, mode: 'council' }));
});
it('does not grant Council session effects to an external command with the same name', async () => {
  const cb = callbacks();
  await runPhysicalTuiContribution({ owner: { id: 'external.fixture' }, payload: {
    inputSchema: { type: 'object' }, run: async () => ({ exitCode: 0, stdout: 'external' }),
  } }, { question: 'Q' }, 'council', cb as never, new AbortController().signal);
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
});
