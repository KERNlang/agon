import{execFileSync}from'node:child_process';import{existsSync,mkdtempSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{describe,expect,it,vi}from'vitest';import type{ModServices,CommandContribution,Registrar}from'@kernlang/agon-mod-api';import{createMod,runConquerTask}from'./implementation.js';
import { assertContributionInput } from '@kernlang/agon-kernel';
import * as verification from '@kernlang/agon-support-verification';
import * as nero from '@kernlang/agon-mod-nero';
import * as tribunal from '@kernlang/agon-mod-tribunal';
import * as council from '@kernlang/agon-mod-council';
import * as worktrees from '@kernlang/agon-support-worktree';
import { runAgentTask } from '@kernlang/agon-mod-agent';
import { afterEach } from 'vitest';
afterEach(() => vi.restoreAllMocks());

it.each(['missing-sentinel', 'empty-claim', 'changed-test', 'new-test', 'valid-claim', 'red-gate', 'no-diff'] as const)(
  'checks completion evidence for %s', async scenario => {
    const cwd = repo();
    writeFileSync(join(cwd, 'guard.test.ts'), 'throw new Error("must implement feature");\n');
    execFileSync('git', ['add', 'guard.test.ts'], { cwd });
    execFileSync('git', ['commit', '-m', 'frozen test fixture'], { cwd });
    const dispatch = vi.fn(async (engineId, _prompt, context, _options) => {
      if (scenario === 'changed-test') writeFileSync(join(context.cwd, 'guard.test.ts'), '// skipped\n');
      else if (scenario === 'new-test') writeFileSync(join(context.cwd, 'new.test.ts'), '// new coverage\n');
      else if (scenario !== 'no-diff') writeFileSync(join(context.cwd, 'feature.txt'), 'implemented\n');
      return { engineId, exitCode: 0,
        stdout: scenario === 'missing-sentinel' ? 'still working' : scenario === 'empty-claim' ? 'CONQUER_DONE' : 'CONQUER_DONE: feature works',
        stderr: '', timedOut: false };
    });
    const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
      engines: { listActive: async () => ['builder'], dispatch } } as unknown as ModServices;
    const result = await runConquerTask({ task: 'implement feature without changing existing tests',
      gate: scenario === 'red-gate' ? 'false' : 'true', builder: 'builder', maxTurns: '1' },
    { invocationId: 'completion-evidence', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    const accepted = scenario === 'new-test' || scenario === 'valid-claim';
    expect(result).toMatchObject({ exitCode: accepted ? 0 : 1,
      result: { status: accepted ? 'completed' : 'turn_budget_exceeded' } });
    const reason = scenario === 'changed-test' ? 'L1:'
      : scenario === 'missing-sentinel' || scenario === 'empty-claim' ? 'L2:'
      : scenario === 'red-gate' ? 'L0:'
      : scenario === 'no-diff' ? 'No patch'
      : 'falsifier and oracle-tamper checks not performed';
    expect(result.result).toMatchObject({ turns: [expect.objectContaining({
      completion: { passed: accepted, reason: expect.stringContaining(reason) },
    })] });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][3]).toMatchObject({ systemPrompt: expect.stringContaining('CONQUER_DONE') });
  },
);

describe('explicit engine resolution across Conquer workflows', () => {
  const workflows = [
    { name: 'Agent', run: runAgentTask, input: { task: 'inspect', engines: 'alias-a,alias-b' } },
    { name: 'Nero', run: nero.runNero, input: { decision: 'ship', engines: 'alias-a,alias-b' } },
    { name: 'Council', run: council.runCouncil, input: { question: 'ship', engines: 'alias-a,alias-b', chairman: 'alias-a' } },
    { name: 'Tribunal', run: tribunal.runTribunal, input: { question: 'ship', engines: 'alias-a,alias-b', rounds: '1' } },
  ];
  it.each(workflows)('$name resolves explicit aliases outside the default roster', async ({ run, input }) => {
    const resolveRequested = vi.fn(async (ids: readonly string[]) => ids.map(id => id.replace('alias-', 'selected-')));
    const dispatch = vi.fn(async (engineId: string) => ({ engineId, exitCode: 0, stdout: 'Confidence: 80%\nVERDICT: SOUND', stderr: '', timedOut: false }));
    const services = { receipts: { record: vi.fn(async () => 'fixture') },
      engines: { listActive: async () => ['default-a', 'default-b'], resolveRequested, dispatch } } as unknown as ModServices;
    const result = await run(input, { invocationId: 'explicit-pool', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(result.exitCode).toBe(0);
    expect(resolveRequested).toHaveBeenCalledWith(['alias-a', 'alias-b'], expect.anything());
    expect(dispatch).toHaveBeenCalled();
    expect(dispatch.mock.calls.every(([id]) => ['selected-a', 'selected-b'].includes(id))).toBe(true);
  });
  it.each(workflows)('$name rejects resolver failures without dispatch or receipts', async ({ run, input }) => {
    const dispatch = vi.fn();
    const record = vi.fn();
    const services = { receipts: { record }, engines: { listActive: async () => ['alias-a', 'alias-b'], dispatch,
      resolveRequested: async () => { throw new Error('Selected engine is removed or unavailable'); } } } as unknown as ModServices;
    const result = await run(input, { invocationId: 'rejected-pool', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('Selected engine is removed or unavailable') });
    expect(dispatch).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it.each(workflows)('$name preserves the default roster when no engine is selected', async ({ run, input }) => {
    const resolveRequested = vi.fn(async () => { throw new Error('Defaults must not use explicit resolution'); });
    const dispatch = vi.fn(async (engineId: string) => ({ engineId, exitCode: 0, stdout: 'Confidence: 80%\nVERDICT: SOUND', stderr: '', timedOut: false }));
    const services = { receipts: { record: vi.fn(async () => 'fixture') },
      engines: { listActive: async () => ['default-a', 'default-b'], resolveRequested, dispatch } } as unknown as ModServices;
    const defaultInput = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'engines' && key !== 'chairman'));
    const result = await run(defaultInput, { invocationId: 'default-pool', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(result.exitCode).toBe(0);
    expect(resolveRequested).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalled();
    expect(dispatch.mock.calls.every(([id]) => ['default-a', 'default-b'].includes(id))).toBe(true);
  });
  it.each(workflows.slice(0, 2))('$name preserves the singular engine override', async ({ run, input }) => {
    const resolveRequested = vi.fn(async (ids: readonly string[]) => ids.map(id => id.replace('alias-', 'selected-')));
    const dispatch = vi.fn(async (engineId: string) => ({ engineId, exitCode: 0, stdout: 'Confidence: 80%\nVERDICT: SOUND', stderr: '', timedOut: false }));
    const services = { receipts: { record: vi.fn(async () => 'fixture') },
      engines: { listActive: async () => ['default-a'], resolveRequested, dispatch } } as unknown as ModServices;
    const result = await run({ ...input, engine: 'alias-b' }, { invocationId: 'forced-engine', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(result.exitCode).toBe(0);
    expect(resolveRequested).toHaveBeenCalledWith(['alias-b'], expect.anything());
    expect(dispatch.mock.calls.map(([id]) => id)).toEqual(['selected-b']);
  });
  it('keeps canonical selections through real Agent, Nero, Tribunal and Council calls', async () => {
    const cwd = repo();
    const resolveRequested = vi.fn(async (ids: readonly string[]) => ids.map(id => id.replace('alias-', 'selected-')));
    const dispatch = vi.fn(async (engineId: string, _prompt: string) => ({ engineId, exitCode: 0, stdout: 'Confidence: 80%\nVERDICT: SOUND', stderr: '', timedOut: false }));
    const record = vi.fn(async () => 'fixture');
    const services = { logger: { debug: vi.fn() }, receipts: { record },
      engines: { listActive: async () => ['default-a', 'default-b'], resolveRequested, dispatch } } as unknown as ModServices;
    const result = await runConquerTask({ task: 'build feature', gate: 'false', builder: 'alias-builder', engines: 'alias-a,alias-b', maxTurns: '3' },
      { invocationId: 'nested-pool', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(result).toMatchObject({ exitCode: 1, result: { status: 'turn_budget_exceeded', builder: 'selected-builder', advisors: ['selected-a', 'selected-b'] } });
    expect(dispatch.mock.calls.filter(([id]) => id === 'selected-builder')).toHaveLength(3);
    expect(dispatch.mock.calls.some(([id]) => id === 'selected-a')).toBe(true);
    expect(dispatch.mock.calls.some(([id]) => id === 'selected-b')).toBe(true);
    expect(dispatch.mock.calls.every(([id]) => ['selected-builder', 'selected-a', 'selected-b'].includes(id))).toBe(true);
    for (const mode of ['nero', 'tribunal', 'council']) expect(record).toHaveBeenCalledWith(mode, expect.anything());
    expect(dispatch.mock.calls.some(([, prompt]) => prompt.includes('You are Nero'))).toBe(true);
    expect(dispatch.mock.calls.some(([, prompt]) => prompt.startsWith('ROLE:'))).toBe(true);
    expect(dispatch.mock.calls.some(([, prompt]) => prompt.startsWith('Frame this question'))).toBe(true);
    expect(dispatch.mock.calls.some(([, prompt]) => prompt.startsWith('Synthesize one accountable'))).toBe(true);
  });
  it.each([false, true])('resolves a non-default forced chair before effects (rejected=%s)', async rejected => {
    const resolveRequested = vi.fn(async (ids: readonly string[]) => {
      if (rejected && ids.length === 1) throw new Error('Chair unavailable');
      return ids.map(id => id.replace('alias-', 'selected-'));
    });
    const rank = vi.fn(async () => [{ engineId: 'selected-a', reason: 'top-rated', scope: 'tribunal' }]);
    const dispatch = vi.fn(async (engineId: string, _prompt: string) => ({ engineId, exitCode: 0, stdout: 'Confidence: 80%\nVERDICT: SOUND', stderr: '', timedOut: false }));
    const record = vi.fn(async () => 'fixture');
    const services = { receipts: { record }, engines: { listActive: async () => ['default-a'], resolveRequested, rank, dispatch } } as unknown as ModServices;
    const result = await council.runCouncil({ question: 'ship', engines: 'alias-a,alias-b', chairman: 'alias-b' },
      { invocationId: 'forced-chair', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(resolveRequested.mock.calls.map(([ids]) => ids)).toEqual([['alias-a', 'alias-b'], ['alias-b']]);
    if (rejected) {
      expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('Chair unavailable') });
      expect(dispatch).not.toHaveBeenCalled();
      expect(rank).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    } else {
      expect(result).toMatchObject({ exitCode: 0, result: { chairmanId: 'selected-b', chairmanReason: 'forced' } });
      expect(dispatch.mock.calls.filter(([, prompt]) => prompt.startsWith('Frame this question') || prompt.startsWith('Synthesize one accountable')).map(([id]) => id)).toEqual(['selected-b', 'selected-b']);
    }
  });
  it.each([council.runCouncil, tribunal.runTribunal])('rejects a resolved one-engine panel before dispatch', async run => {
    const dispatch = vi.fn();
    const services = { engines: { resolveRequested: async () => ['same-engine'], dispatch } } as unknown as ModServices;
    const result = await run({ question: 'ship', engines: 'alias-a,alias-b' },
      { invocationId: 'thin-panel', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('at least 2 engines') });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('deduplicates canonical advisors and removes the canonical builder', async () => {
    const cwd = repo();
    const resolveRequested = vi.fn(async (ids: readonly string[]) => ids.map(id => id === 'builder-alias' ? 'builder' : id === 'advisor-alias' ? 'advisor' : id));
    const dispatch = vi.fn(async (engineId: string) => ({ engineId, exitCode: 0, stdout: 'Confidence: 80%\nVERDICT: SOUND', stderr: '', timedOut: false }));
    const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
      engines: { listActive: async () => ['default'], resolveRequested, dispatch } } as unknown as ModServices;
    const result = await runConquerTask({ task: 'build feature', gate: 'false', builder: 'builder-alias', engines: 'builder,builder-alias,advisor,advisor-alias', maxTurns: '1' },
      { invocationId: 'canonical-dedup', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(result).toMatchObject({ result: { builder: 'builder', advisors: ['advisor'] } });
    // Duplicate aliases must not satisfy the current two-advisor threshold.
    expect(dispatch.mock.calls.map(([id]) => id)).toEqual(['builder']);
  });
  it.each([
    { name: 'Agent', run: runAgentTask, input: { task: 'inspect' }, rejects: false },
    { name: 'Nero', run: nero.runNero, input: { decision: 'ship' }, rejects: true },
  ])('$name preserves validation of a superseded pool', async ({ run, input, rejects }) => {
    const resolveRequested = vi.fn(async (ids: readonly string[]) => {
      if (ids.includes('removed')) throw new Error('Pool engine removed');
      return ids;
    });
    const dispatch = vi.fn(async (engineId: string) => ({ engineId, exitCode: 0, stdout: 'Confidence: 80%\nVERDICT: SOUND', stderr: '', timedOut: false }));
    const services = { receipts: { record: vi.fn(async () => 'fixture') }, engines: { resolveRequested, dispatch } } as unknown as ModServices;
    const result = await run({ ...input, engine: 'valid', engines: 'removed' },
      { invocationId: 'override-validation', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(result.exitCode).toBe(rejects ? 1 : 0);
    expect(dispatch.mock.calls.map(([id]) => id)).toEqual(rejects ? [] : ['valid']);
    expect(resolveRequested.mock.calls.map(([ids]) => ids)).toEqual(rejects ? [['removed']] : [['valid']]);
  });
  it('rejects invalid advisors before creating a worktree or running the builder', async () => {
    const cwd = repo();
    const arena = vi.spyOn(worktrees, 'createForgeArena');
    const dispatch = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'fixture stop', timedOut: false }));
    const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') }, engines: { listActive: async () => ['builder'], dispatch,
      resolveRequested: async (ids: readonly string[]) => { if (ids.includes('bad-advisor')) throw new Error('Invalid advisor'); return ids; } } } as unknown as ModServices;
    const result = await runConquerTask({ task: 'build feature', gate: 'true', builder: 'builder', engines: 'bad-advisor' },
      { invocationId: 'invalid-advisor', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('Invalid advisor') });
    expect(arena).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

it.each([
  ['maxTurns', 0], ['maxTurns', -1], ['maxTurns', '0'],
  ['maxTurns', ''], ['maxTurns', 'invalid'],
  ['maxTurns', '   '], ['maxTurns', 'Infinity'],
  ['maxHours', -1], ['maxHours', '-0.5'], ['maxHours', 'invalid'],
] as const)('rejects invalid %s=%s before creating a worktree or dispatching', async (key, value) => {
  const cwd = repo();
  const arena = vi.spyOn(worktrees, 'createForgeArena');
  const dispatch = vi.fn(async engineId => ({ engineId, exitCode: 1, stdout: '', stderr: 'fixture stop', timedOut: false }));
  const record = vi.fn(async () => 'fixture');
  const services = { logger: { debug: vi.fn() }, receipts: { record },
    engines: { listActive: async () => ['builder'], dispatch } } as unknown as ModServices;
  const result = await runConquerTask({ task: 'build feature', gate: 'true', builder: 'builder', [key]: value },
    { invocationId: 'invalid-budget', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining(`Invalid --${key === 'maxTurns' ? 'max-turns' : 'max-hours'}`) });
  expect(arena).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});
function repo(){const cwd=mkdtempSync(join(tmpdir(),'agon-conquer-'));execFileSync('git',['init'],{cwd});execFileSync('git',['config','user.email','c@example.invalid'],{cwd});execFileSync('git',['config','user.name','C'],{cwd});writeFileSync(join(cwd,'README.md'),'x\n');execFileSync('git',['add','.'],{cwd});execFileSync('git',['commit','-m','base'],{cwd});return cwd;}

it.each([
  { input: {}, turns: 40 },
  { input: { maxTurns: 201 }, turns: 201 },
  { input: { maxTurns: '2turns' }, turns: 2 },
  { input: { maxTurns: '2.9' }, turns: 2 },
  { input: { maxTurns: '2e2' }, turns: 2 },
  { input: { maxTurns: '3', maxHours: '' }, turns: 3 },
  { input: { maxTurns: '3', maxHours: '   ' }, turns: 3 },
  { input: { maxTurns: '3', maxHours: 0 }, turns: 3 },
  { input: { maxTurns: '3', maxHours: '0' }, turns: 3 },
  { input: { maxTurns: '3', maxHours: 'Infinity' }, turns: 3 },
  { input: { maxTurns: '3', maxHours: '0.5hours' }, turns: 1 },
])('preserves legacy budget parsing for $input', async ({ input, turns }) => {
  const cwd = repo();
  const cleanup = vi.fn();
  vi.spyOn(worktrees, 'createForgeArena').mockReturnValue({
    repoRoot: cwd, rootPath: join(cwd, 'unused-arena'), baseSha: 'fixture', dirtySourceExcluded: false,
    create: engineId => ({ engineId, path: cwd }), diff: () => '', cleanup,
  });
  const fitness = vi.spyOn(verification, 'runFitnessCommand').mockResolvedValue({
    exitCode: 1, stdout: '', stderr: '', timedOut: false, durationMs: 1,
  });
  const started = Date.now();
  const dispatch = vi.fn(async engineId => {
    if (input.maxHours !== undefined) vi.spyOn(Date, 'now').mockReturnValue(started + 3_600_000);
    return { engineId, exitCode: 0, stdout: 'working', stderr: '', timedOut: false };
  });
  const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder'], dispatch } } as unknown as ModServices;
  const result = await runConquerTask({ task: 'build feature', gate: 'false', builder: 'builder', ...input },
    { invocationId: 'legacy-budget', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(result).toMatchObject({ exitCode: 1, result: { status: input.maxHours === '0.5hours' ? 'time_budget_exceeded' : 'turn_budget_exceeded' } });
  expect(dispatch).toHaveBeenCalledTimes(turns);
  expect(fitness).toHaveBeenCalledTimes(turns);
  expect(cleanup).toHaveBeenCalledOnce();
});

it.each(['timeout', 'gateTimeout'].flatMap(key => ['-2', '0', 'invalid', '7.9', '9'.repeat(400), ...(key === 'timeout' ? ['1000000000000000000000'] : [])].map(value => ({ key, value, label: value.length > 30 ? 'overflow' : value }))))('preserves legacy $key fallback for $label', async ({ key, value }) => {
  const cwd = repo();
  const fitness = vi.spyOn(verification, 'runFitnessCommand');
  const dispatch = vi.fn(async (engineId, _prompt, context, _options) => {
    writeFileSync(join(context.cwd, 'feature.txt'), 'requested feature\n');
    return { engineId, exitCode: 0, stdout: 'CONQUER_DONE: feature exists', stderr: '', timedOut: false };
  });
  const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder'], dispatch } } as unknown as ModServices;
  const result = await runConquerTask({ task: 'build feature', gate: 'true', builder: 'builder', maxTurns: '1', [key]: value },
    { invocationId: 'timeout-fallback', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(result.exitCode).toBe(0);
  expect(dispatch).toHaveBeenCalledOnce();
  const expectedBuilderTimeout = key !== 'timeout' ? 600 : value === '7.9' ? 7 : value === '1000000000000000000000' ? 1e21 : 600;
  expect(dispatch.mock.calls[0][3]).toMatchObject({ timeoutSeconds: expectedBuilderTimeout });
  expect(fitness).toHaveBeenCalledOnce();
  expect(fitness.mock.calls[0][2]).toBe(key === 'gateTimeout' && value === '7.9' ? 7 : 1800);
});

it('forwards fallback timeouts to advisors without changing independent Agent defaults', async () => {
  const cwd = repo();
  const consults = [vi.spyOn(nero, 'runNero'), vi.spyOn(tribunal, 'runTribunal'), vi.spyOn(council, 'runCouncil')];
  for (const consult of consults) consult.mockResolvedValue({ exitCode: 0, stdout: 'fixture advice' });
  const dispatch = vi.fn(async (engineId, _prompt, _context, _options) => ({ engineId, exitCode: 0, stdout: 'working', stderr: '', timedOut: false }));
  const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder', 'advisor-a', 'advisor-b'], dispatch } } as unknown as ModServices;
  const context = { invocationId: 'advisor-timeout', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} } as const;
  const result = await runConquerTask({ task: 'build feature', gate: 'false', builder: 'builder', maxTurns: '3', timeout: '-2' }, context, services);
  expect(result).toMatchObject({ exitCode: 1, result: { status: 'turn_budget_exceeded' } });
  for (const consult of consults) {
    expect(consult).toHaveBeenCalledOnce();
    expect(consult.mock.calls[0][0]).toMatchObject({ timeout: '600' });
  }
  expect(dispatch).toHaveBeenCalledTimes(3);
  for (const call of dispatch.mock.calls) expect(call[3]).toMatchObject({ timeoutSeconds: 600 });
  dispatch.mockClear();
  await runAgentTask({ task: 'direct task', engine: 'builder', timeout: '-2' }, context, services);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(dispatch.mock.calls[0][3]).toMatchObject({ timeoutSeconds: 1 });
});

it('keeps the real Nero consultation inside the explicitly selected advisor pool', async () => {
  const cwd = repo();
  const dispatch = vi.fn(async (engineId, _prompt, _context, options) => ({
    engineId, exitCode: 0, stdout: options.mode === 'agent' ? 'working' : 'Confidence: 80%\nVERDICT: SOUND',
    stderr: '', timedOut: false,
  }));
  const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder', 'unselected', 'advisor-a', 'advisor-b'], dispatch } } as unknown as ModServices;
  const result = await runConquerTask({ task: 'build feature', gate: 'false', builder: 'builder', engines: 'advisor-a,advisor-b', maxTurns: '1' },
    { invocationId: 'nero-advisor-pool', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(result).toMatchObject({ exitCode: 1, result: { status: 'turn_budget_exceeded', advisors: ['advisor-a', 'advisor-b'] } });
  expect(dispatch.mock.calls.map(call => call[0])).toEqual(['builder', 'advisor-a']);
});

it.each(['green-baseline', 'failed', 'timed-out', 'thrown', 'aborted'] as const)('preserves the builder execution boundary when %s', async scenario => {
  const cwd = repo();
  const controller = new AbortController();
  const paths: string[] = [];
  const fitness = vi.spyOn(verification, 'runFitnessCommand');
  const dispatch = vi.fn(async (engineId, _prompt, context) => {
    paths.push(context.cwd);
    writeFileSync(join(context.cwd, 'feature.txt'), 'requested feature\n');
    if (scenario === 'thrown') throw new Error('fixture provider failure');
    if (scenario === 'aborted') controller.abort();
    return { engineId, exitCode: scenario === 'failed' ? 1 : 0,
      stdout: 'CONQUER_DONE: feature.txt contains the requested feature',
      stderr: scenario === 'failed' ? 'fixture failed' : '', timedOut: scenario === 'timed-out' };
  });
  const record = vi.fn(async () => 'fixture');
  const services = {
    logger: { debug: vi.fn() }, receipts: { record },
    engines: { listActive: async () => ['builder', 'advisor-a', 'advisor-b'], dispatch },
  } as unknown as ModServices;
  const gate = scenario === 'green-baseline' ? 'true' : 'test -f feature.txt';
  const result = await runConquerTask({ task: 'add feature', gate, builder: 'builder', maxTurns: '3' },
    { invocationId: 'builder-boundary', cwd, platform: 'darwin-arm64', signal: controller.signal, config: {} }, services);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(dispatch.mock.calls[0][0]).toBe('builder');
  expect(existsSync(join(cwd, 'feature.txt'))).toBe(false);
  expect(paths).toHaveLength(1);
  expect(paths.every(path => !existsSync(path))).toBe(true);
  const expectedStatus = scenario === 'green-baseline' ? 'completed' : scenario === 'aborted' ? 'cancelled' : 'builder_failed';
  expect(result).toMatchObject({ exitCode: scenario === 'green-baseline' ? 0 : 1,
    result: { status: expectedStatus, turns: [expect.objectContaining({ turn: 1, done: scenario === 'green-baseline' })] } });
  expect(record).toHaveBeenCalledWith('conquer', expect.objectContaining({ status: expectedStatus }));
  if (scenario === 'green-baseline') {
    expect(fitness).toHaveBeenCalledOnce();
    expect(result.result).toMatchObject({ winningPatch: expect.stringContaining('feature.txt') });
  } else {
    expect(fitness).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({ lastPatch: expect.stringContaining('feature.txt') });
  }
});

it.each([1, 2, 3])('stops before advisory dispatch when verification is cancelled on turn %s', async cancelTurn => {
  const cwd = repo();
  const controller = new AbortController();
  const consults = [vi.spyOn(nero, 'runNero'), vi.spyOn(tribunal, 'runTribunal'), vi.spyOn(council, 'runCouncil')];
  for (const consult of consults) consult.mockResolvedValue({ exitCode: 0, stdout: 'fixture advice' });
  const runFitness = verification.runFitnessCommand;
  let checks = 0;
  const fitness = vi.spyOn(verification, 'runFitnessCommand').mockImplementation(async (...args) => {
    const result = await runFitness(...args);
    if (++checks === cancelTurn) { controller.abort(); return { ...result, aborted: cancelTurn !== 1 }; }
    return result;
  });
  const paths: string[] = [];
  const dispatch = vi.fn(async (engineId, _prompt, context) => {
    paths.push(context.cwd);
    writeFileSync(join(context.cwd, `turn-${paths.length}.txt`), 'partial work\n');
    return { engineId, exitCode: 0, stdout: 'CONQUER_DONE: the feature works', stderr: '', timedOut: false };
  });
  const record = vi.fn(async () => 'fixture');
  const services = { logger: { debug: vi.fn() }, receipts: { record },
    engines: { listActive: async () => ['builder', 'advisor-a', 'advisor-b'], dispatch } } as unknown as ModServices;
  const result = await runConquerTask({ task: 'build feature', gate: cancelTurn === 1 ? 'true' : 'false', builder: 'builder', maxTurns: '4' },
    { invocationId: 'gate-cancellation', cwd, platform: 'darwin-arm64', signal: controller.signal, config: {} }, services);
  expect(result).toMatchObject({ exitCode: 1, result: { status: 'cancelled', lastPatch: expect.stringContaining(`turn-${cancelTurn}.txt`) } });
  expect(fitness).toHaveBeenCalledTimes(cancelTurn);
  expect(dispatch).toHaveBeenCalledTimes(cancelTurn);
  for (const [index, consult] of consults.entries()) expect(consult).toHaveBeenCalledTimes(index < cancelTurn - 1 ? 1 : 0);
  expect(record).toHaveBeenCalledWith('conquer', expect.objectContaining({ status: 'cancelled', turns: expect.arrayContaining([expect.objectContaining({ turn: cancelTurn, done: false })]) }));
  expect(paths.every(path => !existsSync(path))).toBe(true);
});

it.each(['failed', 'timed-out'])('preserves prior work when the second builder turn is %s', async scenario => {
  const cwd = repo();
  const fitness = vi.spyOn(verification, 'runFitnessCommand');
  const consult = vi.spyOn(nero, 'runNero').mockResolvedValue({ exitCode: 0, stdout: 'fixture advice' });
  const paths: string[] = [];
  const dispatch = vi.fn(async (engineId, _prompt, context) => {
    paths.push(context.cwd);
    writeFileSync(join(context.cwd, `turn-${paths.length}.txt`), 'partial work\n');
    return { engineId, exitCode: paths.length === 2 && scenario === 'failed' ? 1 : 0,
      stdout: 'partial output', stderr: 'fixture failure', timedOut: paths.length === 2 && scenario === 'timed-out' };
  });
  const record = vi.fn(async () => 'fixture');
  const services = { logger: { debug: vi.fn() }, receipts: { record },
    engines: { listActive: async () => ['builder', 'advisor-a', 'advisor-b'], dispatch } } as unknown as ModServices;
  const result = await runConquerTask({ task: 'build feature', gate: 'false', builder: 'builder', maxTurns: '4' },
    { invocationId: 'late-builder-failure', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(result).toMatchObject({ exitCode: 1, result: { status: 'builder_failed', turns: [
    expect.objectContaining({ turn: 1, done: false }), expect.objectContaining({ turn: 2, done: false, gate: null }),
  ], lastPatch: expect.stringContaining('turn-1.txt') } });
  expect(result.result).toMatchObject({ lastPatch: expect.stringContaining('turn-2.txt') });
  expect(dispatch).toHaveBeenCalledTimes(2);
  expect(fitness).toHaveBeenCalledOnce();
  expect(consult).toHaveBeenCalledOnce();
  expect(record).toHaveBeenCalledWith('conquer', expect.objectContaining({ status: 'builder_failed' }));
  expect(paths.every(path => !existsSync(path))).toBe(true);
});

it.each(['tui', 'argument-only', 'direct', 'canonical-precedence', 'deadline'] as const)('preserves %s turn, timeout and advisor selections', async (entry) => {
  const cwd = repo();
  const fitness = vi.spyOn(verification, 'runFitnessCommand');
  const started = Date.now();
  const dispatch = vi.fn(async (engineId, _prompt, _context, _options) => {
    if (entry === 'deadline') vi.spyOn(Date, 'now').mockReturnValue(started + 3_600_000);
    return { engineId, exitCode: 0, stdout: 'still working', stderr: '', timedOut: false };
  });
  const services = {
    identity: { id: 'agon.conquer', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record: vi.fn(async () => 'fixture') },
    permissions: { check: vi.fn() }, state: { read: vi.fn(), write: vi.fn() },
    engines: {
      listActive: async () => ['builder', 'advisor-a', 'advisor-b'],
      rank: async (ids: readonly string[]) => ids.map(engineId => ({ engineId, reason: 'fixture', scope: null })),
      dispatch,
    },
  } as unknown as ModServices;
  let contribution: CommandContribution | undefined;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'tui') contribution = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  await (await createMod(services)).activate(registrar);
  const parsed = await contribution!.parse!(`${entry === 'argument-only' ? '' : '/conquer '}build feature --gate false --builder builder --engines advisor-a --max-turns 1 --timeout 7 --gate-timeout 9 --max-hours 0.5`);
  const canonical = JSON.parse(JSON.stringify(parsed));
  assertContributionInput(contribution!.inputSchema, canonical);
  expect(canonical).toEqual({ task: 'build feature', gate: 'false', builder: 'builder', engineIds: ['advisor-a'], maxTurns: 1, turnTimeout: 7, gateTimeout: 9, maxHours: 0.5 });
  const input = entry === 'deadline'
    ? { ...canonical, maxTurns: 2 }
    : entry === 'direct'
    ? { task: 'build feature', gate: 'false', builder: 'builder', engineIds: ['advisor-a'], maxTurns: 1, turnTimeout: 7, gateTimeout: 9, maxHours: 0.5 }
    : entry === 'canonical-precedence'
      ? { ...canonical, engines: 'advisor-a', timeout: '7', engineIds: ['advisor-b'], turnTimeout: 99 }
      : canonical;
  const before = structuredClone(input);
  Object.freeze(input.engineIds);
  Object.freeze(input);
  const context = {
    invocationId: 'tui-options', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {},
  } as const;
  const result = entry === 'direct'
    ? await runConquerTask(input, context, services)
    : await contribution!.run(input, context);
  if (Symbol.asyncIterator in result) throw new Error('Unexpected streaming Conquer result');
  expect(result.exitCode).toBe(1);
  expect(result.result).toMatchObject({ status: entry === 'deadline' ? 'time_budget_exceeded' : 'turn_budget_exceeded', advisors: ['advisor-a'], turns: [expect.any(Object)] });
  expect(input).toEqual(before);
  expect(fitness).toHaveBeenCalledOnce();
  for (const call of fitness.mock.calls) {
    expect(call[0]).toBe('false');
    expect(call[1]).not.toBe(cwd);
    expect(call[2]).toBe(9);
    expect(call[3]).toBe(context.signal);
  }
  expect(dispatch).toHaveBeenCalledOnce();
  expect(dispatch.mock.calls[0][0]).toBe('builder');
  expect(dispatch.mock.calls[0][3]).toMatchObject({ timeoutSeconds: 7 });
});
describe('physical conquer mod',()=>{it('iterates in one isolated worktree until the gate, then receipts the patch and cleans up',async()=>{const cwd=repo();let agentTurns=0;const paths:string[]=[];const dispatch=vi.fn(async(id:string,prompt:string,context:any,options:any)=>{if(options.mode==='agent'){agentTurns++;paths.push(context.cwd);if(agentTurns===2)writeFileSync(join(context.cwd,'solved.txt'),'yes\n');return{id,exitCode:0,stdout:agentTurns===2?'CONQUER_DONE: solved.txt contains the requested result':'worked',stderr:'',timedOut:false};}return{id,exitCode:0,stdout:'VERDICT: CONTINUE\nCONFIDENCE: 80',stderr:'',timedOut:false};});const services={identity:{id:'agon.conquer',version:'1',contentHash:`sha256:${'a'.repeat(64)}`},source:'bundled',logger:{debug:vi.fn(),info:vi.fn(),warn:vi.fn()},receipts:{record:vi.fn(async()=>'conquer-r')},permissions:{check:vi.fn()},state:{read:vi.fn(),write:vi.fn()},engines:{listActive:vi.fn(async()=>['builder','a','b']),rank:vi.fn(async(ids:readonly string[])=>ids.map(engineId=>({engineId,reason:'none',scope:null}))),dispatch}}as unknown as ModServices;const out=await runConquerTask({task:'solve',gate:'test -f solved.txt',builder:'builder',engines:'a,b',maxTurns:'3'}, {invocationId:'c',cwd,platform:'darwin-arm64',signal:new AbortController().signal,config:{}},services);expect(out.exitCode).toBe(0);expect((out.result as any).turns).toHaveLength(2);expect((out.result as any).winningPatch).toContain('solved.txt');expect(existsSync(join(cwd,'solved.txt'))).toBe(false);expect(paths.every(path=>!existsSync(path))).toBe(true);});});
