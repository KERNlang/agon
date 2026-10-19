import { beforeEach, expect, it, vi } from 'vitest';
import type { CommandContribution } from '@kernlang/agon-mod-api';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), spawn: vi.fn(), disabled: false, generation: 0, cwd: '/captured-project',
  contribution: undefined as CommandContribution | undefined }));
vi.mock('@kernlang/agon-core', async original => ({ ...await original<object>(), spawnWithTimeout: mocks.spawn, resolveWorkingDir: () => mocks.cwd }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => ({
  ...await original<object>(), executeProcessCesarRoute: mocks.execute,
  captureProcessSurfaceAuthority: () => {
    const generation = mocks.generation;
    return () => { if (generation !== mocks.generation) throw new Error('stale generation'); };
  },
  processSurfaceCatalog: () => [], processSurfacePublicIds: () => new Set(),
  assertProcessSurfaceAvailable: () => { if (mocks.disabled) throw new Error('Goal disabled'); },
  processSurfaceClient: () => ({ assertAvailable: () => {
    if (mocks.disabled) throw new Error('Goal disabled');
    return { owner: { id: 'agon.goal' }, payload: mocks.contribution };
  } }),
}));
import { createMod } from '../../packages/mod-goal/src/implementation.js';
import { dispatchOrchestrationIntent } from '../../packages/cli/src/signals/dispatch/intent-orchestration.js';

beforeEach(async () => {
  vi.resetAllMocks(); mocks.disabled = false; mocks.generation = 0; mocks.cwd = '/captured-project';
  mocks.spawn.mockRejectedValue(new Error('Forbidden shell/PATH dispatch'));
  const command = vi.fn((_surface: string, _value: CommandContribution) => () => {});
  await createMod({} as never).activate({ command, planStep: () => () => {}, tool: () => () => {}, resultType: () => () => {} } as never);
  mocks.contribution = command.mock.calls.find(([surface]) => surface === 'cli')![1];
  mocks.execute.mockResolvedValue({ exitCode: 0, stdout: 'goal fixture complete' });
});

async function queued(input: string) {
  const jobs: Array<(signal: AbortSignal) => Promise<unknown>> = [];
  const cb = { dispatch: vi.fn(), ctx: {},
    runAsJob: (_kind: string, _label: string, run: (signal: AbortSignal) => Promise<unknown>) => jobs.push(run),
  } as unknown as DispatchCallbacks;
  await dispatchOrchestrationIntent({ type: 'goal', input }, `/goal ${input}`, cb);
  expect(jobs).toHaveLength(1);
  return { run: jobs[0]!, cb };
}

it('routes quoted Goal options through the registry with job cancellation, never PATH', async () => {
  const { run, cb } = await queued('"build a feature" --queue "queue dir" --gate "npm test && echo ok" --no-require-tests --max-hours 2');
  const controller = new AbortController();
  await run(controller.signal);
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('goal', expect.objectContaining({
    intent: 'build a feature', queue: 'queue dir', gate: 'npm test && echo ok', requireTests: false, maxHours: '2',
  }), expect.objectContaining({ signal: controller.signal }));
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ content: 'goal fixture complete' }));
});

it.each([
  ['--status --id saved', { status: true, id: 'saved' }],
  ['--resume --id saved', { resume: true, id: 'saved' }],
  ['"new" -g true --dry-run', { intent: 'new', gate: 'true', dryRun: true }],
  [String.raw`"new" --queue queue\ dir --gate 'echo "$HOME" && echo ok' -e builder,critic`,
    { intent: 'new', queue: 'queue dir', gate: 'echo "$HOME" && echo ok', engines: 'builder,critic' }],
  [String.raw`'new' --gate "echo \"quoted\"" --queue prefix' with space'`,
    { intent: 'new', gate: 'echo "quoted"', queue: 'prefix with space' }],
  ['--gate=true -- --status', { intent: '--status', gate: 'true', status: false }],
  ['"" --status --id saved', { intent: '', status: true, id: 'saved' }],
])('preserves Goal command form %s', async (input, expected) => {
  const { run } = await queued(input);
  await run(new AbortController().signal);
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('goal', expect.objectContaining(expected), expect.anything());
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it('refuses a cancelled queued Goal before execution', async () => {
  const { run } = await queued('test --gate true');
  const controller = new AbortController(); controller.abort(new Error('cancelled fixture'));
  await expect(run(controller.signal)).rejects.toThrow('cancelled fixture');
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
});

it('rechecks disabled Goal at job execution', async () => {
  const { run } = await queued('test --gate true'); mocks.disabled = true;
  await expect(run(new AbortController().signal)).rejects.toThrow('Goal disabled');
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
});

it('refuses a generation replaced while the Goal job was queued', async () => {
  const { run } = await queued('test --gate true'); mocks.generation++;
  await expect(run(new AbortController().signal)).rejects.toThrow('stale generation');
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
});

it('reports the physical Goal error instead of success', async () => {
  const { run } = await queued('--resume --id missing');
  mocks.execute.mockResolvedValue({ exitCode: 1, stderr: 'Cannot resume unknown goal' });
  await expect(run(new AbortController().signal)).rejects.toThrow('Cannot resume unknown goal');
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it.each([undefined, 'relative-project'])('retains the queued working directory with override %s', async override => {
  const { run } = await queued(`test --gate true${override ? ` --cwd ${override}` : ''}`);
  mocks.cwd = '/later-project';
  await run(new AbortController().signal);
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('goal',
    expect.objectContaining({ cwd: override ?? '/captured-project' }),
    expect.objectContaining({ cwd: '/captured-project' }));
});

it.each(['test; echo escaped', '$(echo escaped) --gate true', '"unfinished', 'test --gate "`echo escaped`"'])('rejects shell syntax or malformed quoting: %s', async input => {
  const { run } = await queued(input);
  await expect(run(new AbortController().signal)).rejects.toThrow(/shell|quote/i);
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
});
