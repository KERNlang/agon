import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), scan: vi.fn(), continueAllowed: vi.fn(), track: vi.fn(), add: vi.fn(), record: vi.fn(), append: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<object>(), scanProjectContext: mocks.scan, appendMessage: mocks.append, tracker: { record: mocks.track },
}));
vi.mock('../../packages/cli/src/models/session-results.js', () => ({ sessionResultStore: { add: mocks.add } }));
vi.mock('../../packages/cli/src/telemetry/index.js', async original => ({
  ...await original<object>(), recordRun: mocks.record, formatRunSummary: () => 'saved summary',
}));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => ({
  ...await original<object>(), executeProcessCesarRoute: mocks.execute,
}));
vi.mock('../../packages/cli/src/signals/dispatch/delegation.js', async original => ({
  ...await original<object>(), withThreadOutcome: (_cwd: string, _mode: string, _label: string, run: () => Promise<unknown>) => run,
  collectRecentEngineContext: () => '', shouldAutoContinueDelegatedResult: mocks.continueAllowed,
}));
vi.mock('../../packages/cli/src/handlers/cesar-brain.js', async original => ({
  ...await original<object>(), handleCesarBrain: async () => ({ responded: false, delegated: false }),
}));
vi.mock('../../packages/cli/src/cesar/session.js', async original => ({
  ...await original<object>(), resolveCesarBackend: () => ({ backend: 'cli', engine: { id: 'fixture' } }), buildCesarSystemPrompt: () => 'fixture',
}));
import { handleDelegatedAction, handleRecoveredDelegation, runCesarBrainFallback } from '../../packages/cli/src/signals/dispatch/cesar-router.js';
import { extractDelegation } from '../../packages/cli/src/cesar/brain-helpers.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.scan.mockReturnValue('project evidence');
  mocks.continueAllowed.mockReturnValue(false);
  mocks.execute.mockResolvedValue({ exitCode: 0, result: { ok: true, chairmanId: 'alpha', actingChairmanId: 'alpha',
    brief: 'Question', seats: [], verdict: 'Use the evidence.', confidence: 90, warnings: [] } });
});

it.each(['delegated', 'recovered', 'fallback'].flatMap(route => ['normal', 'before', 'during'].map(cancel => ({ route, cancel }))))('preserves Council job cancellation: $route/$cancel', async ({ route, cancel }) => {
  const cb = { dispatch: vi.fn(), runAsJob: vi.fn(), askQuestion: vi.fn().mockResolvedValue('y'),
    ctx: { config: {}, activeEngines: () => ['alpha', 'beta'], cesar: {}, chatSession: { id: 'fixture', messages: [] },
      registry: { resolveId: (id: string) => id, activeIds: () => ['alpha', 'beta'] },
      adapter: { dispatch: vi.fn().mockResolvedValue({ stdout: '[SUGGEST:council] Discuss this.' }) }, setCesarSession: vi.fn() } };
  const handoff = JSON.parse(JSON.stringify(extractDelegation('Council', { question: 'Question', roles: ['security', 'delivery'], chairman: 'alpha' })));
  if (route === 'delegated') await handleDelegatedAction(handoff, 'Question', cb as never);
  else if (route === 'recovered') await handleRecoveredDelegation(handoff, 'Question', cb as never);
  else await runCesarBrainFallback('Question', cb as never, null, false);
  expect(cb.runAsJob).toHaveBeenCalledOnce();
  const controller = new AbortController();
  const { signal } = controller;
  cb.dispatch.mockClear();
  mocks.append.mockClear();
  mocks.continueAllowed.mockClear();
  if (cancel === 'before') controller.abort(new Error('job cancelled'));
  if (cancel === 'during') mocks.execute.mockImplementationOnce(async () => {
    cb.dispatch.mockClear();
    controller.abort(new Error('job cancelled'));
    return { exitCode: 0, result: { verdict: 'Late result must not be shown.' } };
  });
  if (cancel !== 'normal') {
    await expect(cb.runAsJob.mock.calls[0][2](signal)).rejects.toThrow('job cancelled');
    expect(mocks.execute).toHaveBeenCalledTimes(cancel === 'before' ? 0 : 1);
    expect(cb.dispatch).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.continueAllowed).not.toHaveBeenCalled();
    return;
  }
  await cb.runAsJob.mock.calls[0][2](signal);
  expect(mocks.execute).toHaveBeenCalledOnce();
  expect(mocks.execute.mock.calls[0][2].signal).toBe(signal);
  expect(mocks.add).toHaveBeenCalledOnce();
  expect(mocks.record).toHaveBeenCalledOnce();
  if (route !== 'fallback') expect(mocks.execute.mock.calls[0][1]).toMatchObject({ roles: 'security,delivery', chairman: 'alpha' });
});
