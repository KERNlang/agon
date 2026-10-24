import { withCouncilFixtureHost } from '../../../tests/fixtures/modular-council-host.js';
import { withTribunalFixtureHost } from '../../../tests/fixtures/modular-tribunal-host.js';
import{execFileSync}from'node:child_process';import{existsSync,mkdtempSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{describe,expect,it,vi}from'vitest';import type{ModServices,CommandContribution,Registrar}from'@kernlang/agon-mod-api';import{createMod,runConquerTask as runConquerTaskImpl}from'./implementation.js';
import { assertContributionInput } from '@kernlang/agon-kernel';
import * as verification from '@kernlang/agon-support-verification';
import * as engineRuntime from '@kernlang/agon-support-engine-runtime';
import * as nero from '@kernlang/agon-mod-nero';
import * as tribunal from '@kernlang/agon-mod-tribunal';
import * as council from '@kernlang/agon-mod-council';
import * as brainstorm from '@kernlang/agon-mod-brainstorm';
import * as worktrees from '@kernlang/agon-support-worktree';
import { runAgentTask } from '@kernlang/agon-mod-agent';
import { afterEach } from 'vitest';
import { renameSync, unlinkSync, rmSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import type { ConquerModServices } from './implementation.js';
import { createConquerHostServices } from './host.js';
import { runPrText } from '@kernlang/agon-mod-forge';
import { createModObservability } from '../../mod-kernel/src/mod-observability.js';
import { createConquerIsolation } from './isolation.js';
import { createSessionWorktree, removeSessionWorktree, findSessionWorktree } from '../../core/src/blocks/worktree-session.js';
import { basename } from 'node:path';
const recordDirectories: string[] = [];
const retainedWorktrees: Array<{ repoRoot: string; branch: string; path: string }> = [];
const fixtureWorktrees = {
  repoRoot: (cwd: string) => execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim(),
  createSessionWorktree(options: Parameters<typeof createSessionWorktree>[0]) {
    const created = createSessionWorktree(options);
    retainedWorktrees.push(created);
    return created;
  },
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const worktree of retainedWorktrees.splice(0)) removeSessionWorktree(worktree.repoRoot, worktree.branch, true);
  for (const directory of recordDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Supply isolated host capabilities to the existing workflow fixtures. */
function withConquerHost(services: ModServices): ConquerModServices {
  const output = mkdtempSync(join(tmpdir(), 'agon-conquer-record-'));
  recordDirectories.push(output);
  const provided = services as ConquerModServices;
  const configured: ConquerModServices = {
    ...services,
    conquer: {
      contextSpine: provided.conquer?.contextSpine ?? (async () => ''),
      open: provided.conquer?.open ?? (context => ({
        assertCurrent: () => {},
        createIsolation: (task, runId, base) => createConquerIsolation(task, context.cwd, fixtureWorktrees, runId, base),
        rankCritics: ids => ids.map(engineId => ({ engineId })),
        getEngine: id => ({ id, binary: id, agent: {} }) as any,
        adapter: { dispatchAgent: async () => ({ exitCode: 0, stdout: 'VERDICT: SOUND', stderr: '',
          durationMs: 1, timedOut: false, diff: '', diffLines: 0, filesChanged: 0 }) },
      })),
    },
    runs: provided.runs ?? {
      start: async () => ({ id: basename(output), path: output, mode: 'conquer', startedAt: new Date().toISOString() }),
      finish: async () => {},
      writeArtifact: async (_run, name, content) => { writeFileSync(join(output, name), content); },
    },
  };
  return configured;
}

async function runConquerTask(...[input, context, services]: Parameters<typeof runConquerTaskImpl>) {
  return runConquerTaskImpl(input, context, withCouncilFixtureHost(withTribunalFixtureHost(withConquerHost(services))));
}

it('preserves human-readable Conquer CLI output and structured results', async () => {
  const cwd = repo();
  const services = withConquerHost({ logger: { debug: vi.fn() },
    receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder'], dispatch: async (_id, _prompt, context) => {
      writeFileSync(join(context.cwd, 'feature.txt'), 'review this feature\n');
      return { exitCode: 0, stdout: 'CONQUER_DONE: feature exists', stderr: '', timedOut: false };
    } },
  } as unknown as ModServices);
  let contribution: CommandContribution | undefined;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'cli') contribution = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  await (await createMod(services)).activate(registrar);
  const result = await contribution!.run({ task: 'build feature', gate: 'test -f feature.txt', maxTurns: '1' },
    { invocationId: 'conquer-cli-output', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
  if (Symbol.asyncIterator in result) throw new Error('Unexpected streaming Conquer result');
  expect(result.exitCode).toBe(0);
  expect(result.result).toMatchObject({ workflow: { done: true }, worktree: { path: expect.any(String) } });
  expect(result.stdout).toContain('Conquer · builder=builder');
  expect(result.stdout).toContain('gate: test -f feature.txt');
  expect(result.stdout).toContain('isolated branch: conquer/');
  expect(result.stdout).toContain('turn 1');
  expect(result.stdout).toContain('✓ Conquered');
  expect(result.stdout).toContain('agon worktree rm');
});

it.each(['complete', 'cancel-start', 'logger-success', 'logger-cancel'] as const)('reports Conquer session progress and retained work: %s', async scenario => {
  const cwd = repo();
  const controller = new AbortController();
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const dispatch = vi.fn(async (_id, _prompt, context) => {
    writeFileSync(join(context.cwd, 'feature.txt'), 'review this feature\n');
    return { exitCode: 0, stdout: 'CONQUER_DONE: feature exists', stderr: '', timedOut: false };
  });
  const services = { logger: { debug: vi.fn(async () => { if (scenario.startsWith('logger-')) throw new Error('diagnostic failed'); }) }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder'], dispatch } } as unknown as ModServices;
  const context = {
    invocationId: 'conquer-session-events', cwd, platform: 'darwin-arm64' as const,
    signal: controller.signal, config: {},
    onWorkflowEvent(event: { type: string; data?: Record<string, unknown> }) {
      if (!event.data) throw new Error('Missing workflow event data');
      events.push({ type: event.type, data: event.data });
      if ((scenario === 'cancel-start' || scenario === 'logger-cancel') && event.type === 'conquer:start') controller.abort(new Error('cancelled at start'));
    },
  };
  const running = runConquerTask({ task: 'build feature', gate: 'test -f feature.txt', maxTurns: '1' }, context, services);
  if (scenario === 'cancel-start' || scenario === 'logger-cancel') {
    await expect(running).rejects.toThrow('cancelled at start');
    expect(dispatch).not.toHaveBeenCalled();
    expect(services.receipts.record).not.toHaveBeenCalled();
  } else {
    const result = await running;
    expect(result.exitCode).toBe(0);
    expect(events).toContainEqual({ type: 'conquer:turn', data: expect.objectContaining({ n: 1, action: 'done-check' }) });
  }
  expect(events[0]).toEqual({ type: 'conquer:start', data: expect.objectContaining({
    builder: 'builder', advisors: [], gate: 'test -f feature.txt', task: 'build feature',
    outputDir: expect.any(String), worktree: expect.objectContaining({ branch: expect.any(String), path: expect.any(String) }),
  }) });
  const retained = events[0].data.worktree as { path: string };
  expect(existsSync(retained.path)).toBe(true);
  expect(existsSync(join(cwd, 'feature.txt'))).toBe(false);
});

it.each(['success', 'failure', 'cancelled', 'committed'] as const)('retains a named review worktree after %s', async outcome => {
  const cwd = repo();
  writeFileSync(join(cwd, 'source-wip.txt'), 'keep source work\n');
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const controller = new AbortController();
  let candidate = '';
  const services = withConquerHost({ logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder'], dispatch: async (_id, _prompt, context) => {
      candidate = context.cwd;
      expect(existsSync(join(candidate, 'source-wip.txt'))).toBe(false);
      writeFileSync(join(candidate, 'feature.txt'), 'review this\n');
      if (outcome === 'committed') {
        execFileSync('git', ['add', 'feature.txt'], { cwd: candidate });
        execFileSync('git', ['commit', '-m', 'fixture implementation'], { cwd: candidate });
      }
      if (outcome === 'cancelled') controller.abort();
      return { exitCode: outcome === 'failure' ? 1 : 0, stdout: 'CONQUER_DONE: feature works', stderr: '', timedOut: false };
    } },
  } as unknown as ModServices);
  const result = await runConquerTaskImpl({ task: 'build review feature', gate: 'true', maxTurns: '1' },
    { invocationId: 'retained', cwd, platform: 'darwin-arm64', signal: controller.signal, config: {} }, services);
  expect(existsSync(candidate)).toBe(true);
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: candidate, encoding: 'utf8' }).trim();
  expect(branch).toMatch(/^conquer\/build-review-feature-/);
  expect(result).toMatchObject({ exitCode: outcome === 'success' || outcome === 'committed' ? 0 : 1,
    result: { worktree: { path: candidate, branch, baseSha }, dirtySourceExcluded: true } });
  const payload = result.result as { outputDir: string; winningPatch?: string; lastPatch?: string };
  expect(payload.winningPatch ?? payload.lastPatch).toContain('+review this');
  expect(JSON.parse(readFileSync(join(payload.outputDir, 'worktree.json'), 'utf8'))).toMatchObject({ path: candidate, branch, baseSha });
  expect(readFileSync(join(cwd, 'source-wip.txt'), 'utf8')).toBe('keep source work\n');
  expect(existsSync(join(cwd, 'feature.txt'))).toBe(false);
});

it('rejects a missing Conquer host before starting provider work', async () => {
  const cwd = repo();
  const dispatch = vi.fn(async (_id, _prompt, context) => {
    writeFileSync(join(context.cwd, 'feature.txt'), 'implemented\n');
    return { exitCode: 0, stdout: 'CONQUER_DONE: feature works', stderr: '', timedOut: false };
  });
  const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder'], dispatch } } as unknown as ModServices;
  const result = await runConquerTaskImpl({ task: 'implement feature', gate: 'true', maxTurns: '1' },
    { invocationId: 'missing-host', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('host capabilities');
  expect(dispatch).not.toHaveBeenCalled();
});

it.each(['uncommitted', 'committed', 'drafted', 'draft-failed', 'draft-cancelled', 'draft-retired', 'draft-disabled', 'draft-malformed', 'no-push', 'denied', 'ask', 'missing-policy', 'incomplete', 'push-failed', 'changed-branch', 'commit-switch'] as const)('physical Conquer publication: %s', async state => {
  const cwd = repo();
  const controller = new AbortController();
  let current = true;
  const hasDraft = state === 'drafted' || state.startsWith('draft-');
  const spawned = vi.spyOn(engineRuntime, 'spawnWithTimeout');
  let processesAtDraft = 0;
  recordDirectories.push(cwd);
  const remote = mkdtempSync(join(tmpdir(), 'agon-conquer-remote-'));
  recordDirectories.push(remote);
  const git = (args: string[], path = cwd) => execFileSync('git', args,
    { cwd: path, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--bare'], remote);
  git(['remote', 'add', 'origin', remote]);
  if (hasDraft) {
    vi.spyOn(worktrees, 'githubRepoUrl').mockReturnValue('https://github.com/fixture/repo');
  }
  const hooks = join(remote, 'fixture-hooks');
  mkdirSync(hooks);
  git(['config', 'core.hooksPath', hooks]);
  git(['config', 'commit.gpgSign', 'false']);
  if (state === 'push-failed') git(['remote', 'set-url', 'origin', join(remote, 'missing-repository')]);
  if (state === 'commit-switch') writeFileSync(join(hooks, 'post-commit'), '#!/bin/sh\ngit checkout -b hook-moved >&2\n', { mode: 0o755 });
  const sourceHead = git(['rev-parse', 'HEAD']);
  const dispatch = vi.fn(async (_id, prompt, context, options) => {
    expect(context).not.toHaveProperty('onWorkflowEvent');
    if (prompt.startsWith('Write the pull-request text')) {
      processesAtDraft = spawned.mock.calls.length;
      expect(options).toMatchObject({ textOnly: true, timeoutSeconds: 300 });
      if (state === 'draft-cancelled') controller.abort(new Error('fixture PR cancelled'));
      if (state === 'draft-retired') current = false;
      return { exitCode: state === 'draft-failed' ? 1 : 0,
        stdout: state === 'draft-malformed' ? 'bad prose' : 'TITLE: feat: fixture\n\nfixture PR body', stderr: '', timedOut: false };
    }
    writeFileSync(join(context.cwd, 'feature.txt'), 'implemented\n');
    if (state === 'changed-branch') git(['checkout', '-b', 'unrelated-feature'], context.cwd);
    if (state === 'committed') {
      git(['add', 'feature.txt'], context.cwd);
      git(['-c', 'commit.gpgSign=false', 'commit', '-m', 'builder implementation'], context.cwd);
    }
    return { exitCode: 0, stdout: state === 'incomplete' ? 'still working' : 'CONQUER_DONE: feature works', stderr: '', timedOut: false };
  });
  const base = withConquerHost({ logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    permissions: { check: vi.fn(async () => state === 'denied' ? 'deny' : state === 'ask' ? 'ask' : 'allow') },
    engines: { listActive: async () => ['builder'], dispatch },
  } as unknown as ModServices);
  const commitBody = vi.fn((claim: string) => claim);
  const services: ConquerModServices = { ...base, conquer: { ...base.conquer!, open: async context => ({
    ...await base.conquer!.open(context),
    ...(state === 'missing-policy' ? {} : { publication: { protectedPushBranches: [], commitBody } }),
  }) } };
  if (hasDraft) {
    Object.assign(services, { receipts: createModObservability({ receiptRoot: join(remote, 'receipts'),
      owner: 'agon.conquer', contentHash: `sha256:${'a'.repeat(64)}`, secretValues: [] }).receipts,
    conquer: createConquerHostServices({
      worktrees: fixtureWorktrees, contextSpine: async () => '',
      openRegistry: () => ({ get: (id: string) => ({ id, binary: id, agent: {} }) as any }),
      createAdapter: () => ({ dispatch: vi.fn(), isAvailable: async () => true, getVersion: async () => null }),
      rankCritics: () => [],
      captureAuthority: () => () => { if (!current) throw new Error('fixture PR retired'); },
      publicationPolicy: () => ({ protectedPushBranches: [], commitBody }),
      draftPullRequest: async (input, send) => {
        if (state === 'draft-disabled') throw new Error('fixture Forge disabled');
        return runPrText(input, { dispatch: send });
      },
    }) });
  }
  const finish = vi.spyOn(services.runs!, 'finish');
  const start = vi.spyOn(services.runs!, 'start');
  const invoke: typeof runConquerTaskImpl = state === 'draft-disabled' ? async (input, context, host) => {
    let command: CommandContribution | undefined;
    const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
      if (method === 'command' && args[0] === 'cli') command = args[1] as CommandContribution;
      return () => {};
    } }) as Registrar;
    await (await createMod(host)).activate(registrar);
    const output = await command!.run(input, context);
    if (Symbol.asyncIterator in output) throw new Error('Unexpected streaming Conquer result');
    return output;
  } : runConquerTaskImpl;
  const result = await invoke({ task: 'publish feature', gate: 'test -f feature.txt',
    builder: 'builder', maxTurns: '1', ...(state === 'no-push' ? {} : { push: true }) },
    { invocationId: 'publication', cwd, platform: 'darwin-arm64', signal: controller.signal, config: {}, onWorkflowEvent: vi.fn() }, services);
  expect(git(['rev-parse', 'HEAD'])).toBe(sourceHead);
  expect(git(['status', '--porcelain'])).toBe('');
  if (state === 'denied' || state === 'ask' || state === 'missing-policy') {
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(state === 'missing-policy' ? 'publication policy' : 'git.write');
    expect(dispatch).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  } else if (state === 'changed-branch' || state === 'commit-switch' || state === 'push-failed' || state === 'incomplete') {
    expect(result.exitCode).toBe(1);
    expect(result.failure?.code).toBe(state === 'incomplete' ? 'CONQUER_INCOMPLETE' : 'CONQUER_PUBLICATION_FAILED');
    if (state === 'changed-branch' || state === 'commit-switch') expect(result.stderr).toContain('branch changed');
    if (state === 'push-failed') expect(result.stderr).toContain('git push failed');
    const payload = result.result as any;
    expect(existsSync(payload.worktree.path)).toBe(true);
    expect(JSON.parse(readFileSync(join(payload.outputDir, 'result.json'), 'utf8')).receiptId).toBe('fixture');
    expect(finish).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ ok: false }), expect.anything());
    if (state === 'commit-switch') expect(git(['branch', '--show-current'], payload.worktree.path)).toBe('hook-moved');
    if (state === 'push-failed') expect(git(['show', 'HEAD:feature.txt'], payload.worktree.path)).toBe('implemented');
    if (state === 'changed-branch') {
      expect(git(['diff', '--cached'], payload.worktree.path)).toBe('');
      expect(payload.pullRequest).toBeUndefined();
      expect(commitBody).not.toHaveBeenCalled();
    }
  } else {
    expect(result.exitCode).toBe(0);
    const payload = result.result as any;
    expect(existsSync(payload.worktree.path)).toBe(true);
    expect(payload.winningPatch).toContain('+implemented');
    if (state === 'no-push') {
      expect(services.permissions.check).not.toHaveBeenCalled();
      expect(commitBody).not.toHaveBeenCalled();
      expect(git(['rev-parse', 'HEAD'], payload.worktree.path)).toBe(sourceHead);
      expect(git(['diff', '--cached'], payload.worktree.path)).toBe('');
    }
    if (state !== 'no-push') {
      expect(payload.publication).toMatchObject({ ok: true, branch: payload.worktree.branch });
      expect(git(['show', `${payload.worktree.branch}:feature.txt`], remote)).toBe('implemented');
      expect(git(['rev-list', '--count', `${sourceHead}..${payload.worktree.branch}`], remote)).toBe('1');
      expect(payload.pullRequest).toMatchObject({ usedTemplate: state !== 'drafted',
        title: state === 'drafted' ? 'feat: fixture' : 'conquer: publish feature' });
      expect(JSON.parse(readFileSync(join(payload.outputDir, 'result.json'), 'utf8')).pullRequest).toEqual(payload.pullRequest);
      if (hasDraft) {
        expect(payload.pullRequest.url).toContain('https://github.com/fixture/repo/compare/');
        expect(dispatch).toHaveBeenCalledTimes(state === 'draft-disabled' ? 1 : 2);
        if (state === 'draft-disabled') {
          expect(result.stdout).toContain(`Pushed ${payload.worktree.branch}.`);
          expect(result.stdout).toContain(payload.pullRequest.mergeHint);
          expect(result.stdout).toContain('merge gate');
        }
        const saved = JSON.parse(readFileSync(join(remote, 'receipts', `${payload.receiptId}.json`), 'utf8'));
        expect(saved.payload.publication.ok).toBe(true);
        expect(saved.payload.pullRequest.usedTemplate).toBe(state !== 'drafted');
        expect(spawned.mock.calls.filter(([options]) => options.command === 'git' && options.args?.[0] === 'push')).toHaveLength(1);
        if (state === 'draft-cancelled' || state === 'draft-retired') expect(spawned).toHaveBeenCalledTimes(processesAtDraft);
      }
      else expect(payload.pullRequest.mergeHint).toContain('merge gate');
    }
  }
  if (state !== 'uncommitted' && state !== 'committed' && !hasDraft) {
    expect(git(['for-each-ref', '--format=%(refname)', 'refs/heads'], remote)).toBe('');
  }
});

it.each((['denied', 'retired', 'cancelled'] as const).flatMap(state =>
  ([['branch', 2], ['add', 3], ['commit', 5], ['push', 7]] as const)
    .map(([stage, checkAt]) => ({ state, stage, checkAt }))))('stops publication when permission await becomes $state before $stage', async ({ state, stage, checkAt }) => {
  const cwd = repo();
  recordDirectories.push(cwd);
  const controller = new AbortController();
  let current = true;
  let candidate = '';
  let checks = 0;
  const base = withConquerHost({ logger: { debug: vi.fn() }, receipts: { record: vi.fn() },
    permissions: { check: async () => {
      checks += 1;
      if (checks === checkAt) {
        await Promise.resolve();
        if (state === 'denied') return 'deny';
        if (state === 'retired') current = false;
        if (state === 'cancelled') controller.abort(new Error('fixture cancelled'));
      }
      return 'allow';
    } },
    engines: { listActive: async () => ['builder'], dispatch: async (_id, _prompt, context) => {
      candidate = context.cwd;
      writeFileSync(join(candidate, 'feature.txt'), 'implemented\n');
      return { exitCode: 0, stdout: 'CONQUER_DONE: feature works', stderr: '', timedOut: false };
    } },
  } as unknown as ModServices);
  const services = { ...base, conquer: { ...base.conquer!, open: async context => ({
    ...await base.conquer!.open(context),
    assertCurrent: () => { if (!current) throw new Error('fixture retired'); },
    publication: { protectedPushBranches: [], commitBody: vi.fn(() => 'fixture') },
  }) } };
  const finish = vi.spyOn(services.runs!, 'finish');
  const result = await runConquerTaskImpl({ task: 'publish feature', gate: 'test -f feature.txt',
    builder: 'builder', maxTurns: '1', push: true },
    { invocationId: 'publication-revoked', cwd, platform: 'darwin-arm64', signal: controller.signal, config: {} }, services);
  expect(result).toMatchObject({ exitCode: 1, failure: { code: 'CONQUER_PUBLICATION_FAILED', retryable: false },
    result: { publication: { ok: false, stage, remoteOutcome: stage === 'push' ? 'unknown' : 'not-attempted' } } });
  expect(result.stderr).toContain(state === 'denied' ? 'git.write permission is deny' : `fixture ${state}`);
  const payload = result.result as any;
  expect(JSON.parse(readFileSync(join(payload.outputDir, 'result.json'), 'utf8')).publication.remoteOutcome)
    .toBe(stage === 'push' ? 'unknown' : 'not-attempted');
  expect(readFileSync(join(payload.outputDir, 'result.patch'), 'utf8')).toContain('+implemented');
  expect(checks).toBe(checkAt);
  expect(readFileSync(join(candidate, 'feature.txt'), 'utf8')).toBe('implemented\n');
  const staged = execFileSync('git', ['diff', '--cached'], { cwd: candidate, encoding: 'utf8' });
  if (stage === 'commit') expect(staged).toContain('+implemented');
  else expect(staged).toBe('');
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  const candidateHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' });
  if (stage === 'push') expect(candidateHead).not.toBe(sourceHead);
  else expect(candidateHead).toBe(sourceHead);
  expect(finish).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ ok: false }), expect.anything());
});

it.each(['builder', 'critic', 'critic-command'] as const)('rejects completion after authority changes during %s work', async phase => {
  const cwd = repo();
  let current = true;
  let candidate = '';
  const critic = vi.fn(async () => {
    current = false;
    return { exitCode: 0, stdout: phase === 'critic-command'
      ? `COUNTEREXAMPLE: printf retired > '${join(cwd, 'retired-effect.txt')}'\nOBSERVED: fixture\nVERDICT: FLAWED`
      : 'VERDICT: SOUND', stderr: '', durationMs: 1,
      timedOut: false, diff: '', diffLines: 0, filesChanged: 0 };
  });
  const conquer = createConquerHostServices({
    worktrees: fixtureWorktrees,
    openRegistry: () => ({ get: (id: string) => ({ id, binary: id, agent: {} }) as any }),
    createAdapter: () => ({ dispatchAgent: critic, dispatch: vi.fn(), isAvailable: async () => true, getVersion: async () => null }),
    rankCritics: (_registry, ids) => ids.map(engineId => ({ engineId })),
    contextSpine: async () => '',
    captureAuthority: () => () => { if (!current) throw new Error('fixture generation retired'); },
  });
  const record = vi.fn(async () => 'fixture');
  const services = withConquerHost({ conquer, receipts: { record }, logger: { debug: vi.fn() },
    engines: { listActive: async () => ['builder', 'critic'], dispatch: async (_id, _prompt, context) => {
      candidate = context.cwd;
      writeFileSync(join(candidate, 'feature.txt'), 'implemented\n');
      if (phase === 'builder') current = false;
      return { exitCode: 0, stdout: 'CONQUER_DONE: feature works', stderr: '', timedOut: false };
    } },
  } as unknown as ModServices);
  const finish = vi.spyOn(services.runs!, 'finish');
  await expect(runConquerTaskImpl({ task: 'implement feature', gate: 'true', builder: 'builder', maxTurns: '1' },
    { invocationId: 'retired-host', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services))
    .rejects.toThrow('fixture generation retired');
  expect(critic).toHaveBeenCalledTimes(phase === 'builder' ? 0 : 1);
  expect(record.mock.calls.some(([mode]) => mode === 'conquer')).toBe(false);
  expect(finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), expect.anything());
  expect(existsSync(candidate)).toBe(true);
  expect(existsSync(join(cwd, 'retired-effect.txt'))).toBe(false);
});

it.each(['current', 'retired', 'cancelled'] as const)('uses current model identity and rechecks authority after lookup: %s', async state => {
  const controller = new AbortController();
  let current = true;
  const identify = vi.fn(async () => {
    if (state === 'retired') current = false;
    if (state === 'cancelled') controller.abort(new Error('fixture cancelled'));
    return 'new-model';
  });
  const rankCritics = vi.fn((_registry: unknown, ids: string[], _identities: Record<string, string | null | undefined>) => ids.map(engineId => ({ engineId })));
  const host = createConquerHostServices({
    worktrees: fixtureWorktrees,
    openRegistry: () => ({ get: (id: string) => ({ id, binary: id, agent: {} }) as any }),
    createAdapter: () => ({ identify, dispatch: vi.fn(), isAvailable: async () => true, getVersion: async () => null }),
    rankCritics, contextSpine: async () => '',
    captureAuthority: () => () => { if (!current) throw new Error('fixture retired'); },
  });
  const opened = await host.open({ invocationId: 'identity', cwd: '/fixture', platform: 'darwin-arm64',
    signal: controller.signal, config: {} });
  const result = opened.rankCritics(['critic']);
  if (state === 'current') {
    await expect(result).resolves.toEqual([{ engineId: 'critic' }]);
    expect(rankCritics).toHaveBeenCalledWith(expect.anything(), ['critic'], { critic: 'new-model' });
  } else {
    await expect(result).rejects.toThrow(`fixture ${state}`);
    expect(rankCritics).not.toHaveBeenCalled();
  }
  expect(identify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'critic' }), '/fixture');
});

it.each(['retired', 'cancelled'] as const)('snapshots publication policy and guards its formatter when %s', async state => {
  const controller = new AbortController();
  let current = true;
  const branches = ['protected-fixture'];
  const format = vi.fn((claim: string) => `claim: ${claim}`);
  const host = createConquerHostServices({
    worktrees: fixtureWorktrees,
    openRegistry: () => ({ get: (id: string) => ({ id, binary: id, agent: {} }) as any }),
    createAdapter: () => ({ dispatch: vi.fn(), isAvailable: async () => true, getVersion: async () => null }),
    rankCritics: () => [], contextSpine: async () => '',
    captureAuthority: () => () => { if (!current) throw new Error('fixture retired'); },
    publicationPolicy: () => ({ protectedPushBranches: branches, commitBody: format }),
  });
  const opened = await host.open({ invocationId: 'policy', cwd: '/fixture', platform: 'darwin-arm64',
    signal: controller.signal, config: {} });
  branches.splice(0);
  expect(opened.publication!.protectedPushBranches).toEqual(['protected-fixture']);
  expect(Object.isFrozen(opened.publication!.protectedPushBranches)).toBe(true);
  expect(opened.publication!.commitBody('verified')).toBe('claim: verified');
  if (state === 'retired') current = false;
  else controller.abort(new Error('fixture cancelled'));
  expect(() => opened.publication!.commitBody('stale')).toThrow(`fixture ${state}`);
  expect(format).toHaveBeenCalledExactlyOnceWith('verified');
});

it('rejects worktree allocation when authority retires during run creation', async () => {
  const cwd = repo();
  let current = true;
  const allocate = vi.spyOn(fixtureWorktrees, 'createSessionWorktree');
  const dispatch = vi.fn();
  const conquer = createConquerHostServices({
    worktrees: fixtureWorktrees,
    openRegistry: () => ({ get: (id: string) => ({ id, binary: id, agent: {} }) as any }),
    createAdapter: () => ({ dispatch, isAvailable: async () => true, getVersion: async () => null }),
    rankCritics: () => [], contextSpine: async () => '',
    captureAuthority: () => () => { if (!current) throw new Error('fixture generation retired'); },
  });
  const services = withConquerHost({ conquer, logger: { debug: vi.fn() },
    receipts: { record: vi.fn() }, engines: { listActive: async () => ['builder'], dispatch },
  } as unknown as ModServices);
  const originalStart = services.runs!.start;
  vi.spyOn(services.runs!, 'start').mockImplementation(async (...args) => {
    const run = await originalStart(...args);
    current = false;
    return run;
  });
  const finish = vi.spyOn(services.runs!, 'finish');
  await expect(runConquerTaskImpl({ task: 'implement feature', gate: 'true', maxTurns: '1' },
    { invocationId: 'retired-before-allocation', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services))
    .rejects.toThrow('fixture generation retired');
  expect(allocate).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), expect.anything());
});

it.each(['artifact', 'finish', 'partial-finish'] as const)('preserves the primary %s error without conflicting finalization', async phase => {
  const cwd = repo();
  const services = withConquerHost({ logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder'], dispatch: async (_id, _prompt, context) => {
      writeFileSync(join(context.cwd, 'feature.txt'), 'implemented\n');
      return { exitCode: 0, stdout: 'CONQUER_DONE: feature works', stderr: '', timedOut: false };
    } },
  } as unknown as ModServices);
  const primary = new Error(`fixture ${phase} failed`);
  const dispatch = vi.spyOn(services.engines, 'dispatch');
  const persisted: boolean[] = [];
  const finish = vi.spyOn(services.runs!, 'finish').mockImplementation(async (_run, status) => {
    if (phase === 'partial-finish') persisted.push(status.ok);
    throw phase === 'artifact' ? new Error('secondary finalization error') : primary;
  });
  if (phase === 'artifact') vi.spyOn(services.runs!, 'writeArtifact').mockRejectedValue(primary);
  await expect(runConquerTaskImpl({ task: 'implement feature', gate: 'true', maxTurns: '1' },
    { invocationId: 'finalization-failure', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services))
    .rejects.toBe(primary);
  expect(finish).toHaveBeenCalledTimes(1);
  if (phase === 'artifact') {
    expect(dispatch).not.toHaveBeenCalled();
    const retained = retainedWorktrees.at(-1)!;
    expect(existsSync(retained.path)).toBe(true);
    expect(findSessionWorktree(cwd, retained.branch)?.path).toBe(retained.path);
  }
  if (phase === 'partial-finish') expect(persisted).toEqual([true]);
});

it.each([false, true])('runs and records the real counterexample command (initially broken=%s)', async initiallyBroken => {
  const cwd = repo();
  const critic = vi.fn(async (options: { cwd: string; engine: { id: string } }) => {
    expect(existsSync(join(options.cwd, 'feature.txt'))).toBe(true);
    return { exitCode: 0, stdout: 'COUNTEREXAMPLE: grep -qx correct feature.txt\nOBSERVED: feature is wrong\nVERDICT: FLAWED',
      stderr: '', durationMs: 1, timedOut: false, diff: '', diffLines: 0, filesChanged: 0 };
  });
  const conquer = createConquerHostServices({
    worktrees: fixtureWorktrees,
    openRegistry: () => ({ get: (id: string) => ({ id, binary: id, agent: {} }) as any }),
    createAdapter: () => ({ dispatchAgent: critic, dispatch: vi.fn(), isAvailable: async () => true, getVersion: async () => null }),
    rankCritics: (_registry, ids) => ids.map(engineId => ({ engineId })),
    contextSpine: async () => '', captureAuthority: () => () => {},
  });
  let builds = 0;
  const dispatch = vi.fn(async (_id, _prompt, context) => {
    writeFileSync(join(context.cwd, 'feature.txt'), initiallyBroken && builds++ === 0 ? 'wrong\n' : 'correct\n');
    return { exitCode: 0, stdout: 'CONQUER_DONE: feature is correct', stderr: '', timedOut: false };
  });
  const services = withConquerHost({ conquer, logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder', 'critic', 'unselected'], dispatch },
  } as unknown as ModServices);
  const finish = vi.spyOn(services.runs!, 'finish');
  const result = await runConquerTaskImpl({ task: 'implement feature', gate: 'true', builder: 'builder', engines: 'critic', maxTurns: '2' },
    { invocationId: 'real-falsifier', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(result.exitCode).toBe(0);
  const payload = result.result as { outputDir: string; winningPatch: string };
  const saved = JSON.parse(readFileSync(join(payload.outputDir, 'result.json'), 'utf8'));
  expect(saved).toEqual(result.result);
  expect(saved.status).toBe('completed');
  expect(saved.turns).toHaveLength(initiallyBroken ? 2 : 1);
  expect(saved.turns[0].completion).toMatchObject({ falsified: initiallyBroken, passed: !initiallyBroken,
    critic: 'critic', counterexample: 'grep -qx correct feature.txt',
    verification: { exitCode: initiallyBroken ? 1 : 0, timedOut: false } });
  expect(saved.turns.at(-1).completion).toMatchObject({ passed: true, falsified: false });
  expect(critic.mock.calls.map(([options]) => options.engine.id)).toEqual(initiallyBroken ? ['critic', 'critic'] : ['critic']);
  if (initiallyBroken) expect(dispatch.mock.calls[1][1]).toContain('A falsifier reproduced a failure: `grep -qx correct feature.txt`');
  expect(readFileSync(join(payload.outputDir, 'result.patch'), 'utf8')).toBe(payload.winningPatch);
  expect(readdirSync(payload.outputDir).some(name => name.startsWith('sandbox-'))).toBe(false);
  expect(existsSync(join(cwd, 'feature.txt'))).toBe(false);
  expect(finish).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ ok: true }), expect.anything());
});

it('cleans allocated worktrees when candidate creation fails', async () => {
  const cwd = repo();
  const createWorktree = worktrees.createSessionWorktree;
  let allocated = '';
  vi.spyOn(worktrees, 'createSessionWorktree').mockImplementation((options, runtime) =>
    createWorktree(options, { ...runtime, absoluteGitDir: path => {
      allocated = path;
      throw new Error('fixture worktree metadata failed');
    } }));
  const dispatch = vi.fn();
  const services = { logger: { debug: vi.fn() }, engines: { listActive: async () => ['builder'], dispatch } } as unknown as ModServices;
  try {
    await expect(runConquerTask({ task: 'build', gate: 'true', builder: 'builder' },
      { invocationId: 'creation-failure', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services))
      .rejects.toThrow('fixture worktree metadata failed');
    expect(allocated).not.toBe('');
    expect(existsSync(allocated)).toBe(false);
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' })).not.toContain(allocated);
    expect(dispatch).not.toHaveBeenCalled();
  } finally {
    if (allocated && existsSync(allocated)) execFileSync('git', ['worktree', 'remove', '--force', allocated], { cwd });
  }
});

it('keeps real host-backed Brainstorm dispatch inside the canonical selected pool', async () => {
  const cwd = repo();
  const output = mkdtempSync(join(tmpdir(), 'agon-conquer-brainstorm-'));
  const registry = { get: (id: string) => ({ schemaVersion: 3 as const, id, displayName: id, isLocal: true,
    tier: 'user' as const, timeout: 10 }), findBinary: () => null };
  const advisorDispatch = vi.fn(async (options: { engine: { id: string }; prompt: string }) => ({
    exitCode: 0, stdout: options.prompt === 'fixture draft' ? JSON.stringify({ approach: 'stream', confidence: 80,
      reasoning: 'bounded memory', keyFiles: [], steps: [], tradeoffs: [] }) : 'SELECTED ADVISOR RESPONSE',
    stderr: '', timedOut: false, durationMs: 1,
  }));
  const host = brainstorm.createBrainstormHostServices({
    openRegistry: () => registry,
    createAdapter: () => ({ dispatch: advisorDispatch, isAvailable: async () => true, getVersion: async () => null }),
    seedRegistry: () => {}, readRatings: () => ({ byMode: { brainstorm: {} }, global: {} }),
    loadConfig: () => ({}), classifyTask: () => 'other', updateRanked: () => {},
    buildPrompt: () => 'fixture draft', parseDraft: raw => JSON.parse(raw),
  });
  let builds = 0;
  const dispatch = vi.fn(async (engineId, _prompt, context) => {
    writeFileSync(join(context.cwd, 'feature.txt'), 'feature\n');
    return { engineId, exitCode: 0, stdout: ++builds === 1 ? 'CONQUER_ASK: how do I start?'
      : 'CONQUER_DONE: implemented', stderr: '', timedOut: false };
  });
  const services = { brainstorm: host, logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    runs: { start: async () => ({ id: 'fixture', path: output, mode: 'brainstorm', startedAt: 'fixture' }),
      finish: vi.fn(), writeArtifact: vi.fn() },
    engines: { listActive: async () => ['builder', 'unselected'], dispatch,
      resolveRequested: async (ids: readonly string[]) => ids.map(id => id === 'advisor-alias' ? 'selected-advisor' : id) },
  } as unknown as ModServices;
  vi.stubEnv('AGON_DISABLE_FORGE_HEALTH_CHECK', '1');
  try {
    const out = await runConquerTask({ task: 'implement reader', gate: 'true', builder: 'builder', engines: 'advisor-alias', maxTurns: '2' },
      { invocationId: 'brainstorm-real-host', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
    expect(out.exitCode).toBe(0);
    expect(advisorDispatch).toHaveBeenCalledTimes(2);
    expect(advisorDispatch.mock.calls.map(([options]) => options.engine.id)).toEqual(['selected-advisor', 'selected-advisor']);
    expect(dispatch.mock.calls.map(([id]) => id)).toEqual(['builder', 'builder']);
    expect(dispatch.mock.calls[1][1]).toContain('[Cesar consulted brainstorm] SELECTED ADVISOR RESPONSE');
  } finally { vi.unstubAllEnvs(); }
});

it('continues ordinary output without running a gate or unsolicited advice', async () => {
  const cwd = repo();
  const fitness = vi.spyOn(verification, 'runFitnessCommand');
  const dispatch = vi.fn(async (engineId, _prompt, _context, _options) => ({
    engineId, exitCode: 0, stdout: 'still working', stderr: '', timedOut: false,
  }));
  const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder', 'a', 'b'], dispatch } } as unknown as ModServices;
  const out = await runConquerTask({ task: 'retain this exact objective', gate: 'false', builder: 'builder', maxTurns: '2' },
    { invocationId: 'ordinary-continuation', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(out).toMatchObject({ exitCode: 1, result: { status: 'turn_budget_exceeded' } });
  expect(dispatch.mock.calls.map(call => call[0])).toEqual(['builder', 'builder']);
  expect(fitness).not.toHaveBeenCalled();
  expect(dispatch.mock.calls[1][1]).toContain('still working');
  for (const call of dispatch.mock.calls) expect(call[1]).toContain('retain this exact objective');
});

it('uses a single selected Nero advisor when the builder asks about its approach', async () => {
  const cwd = repo();
  const dispatch = vi.fn(async (engineId, _prompt, _context, options) => ({
    engineId, exitCode: 0, stdout: options.mode === 'agent' ? 'CONQUER_ASK: is this approach wrong?'
      : 'Confidence: 80%\nVERDICT: SOUND', stderr: '', timedOut: false,
  }));
  const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder', 'advisor', 'unselected'], dispatch } } as unknown as ModServices;
  await runConquerTask({ task: 'build feature', gate: 'false', builder: 'builder', engines: 'advisor', maxTurns: '1' },
    { invocationId: 'single-advisor', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(dispatch.mock.calls.map(call => call[0])).toEqual(['builder', 'advisor']);
});

it('routes ideation to Brainstorm and returns its response, not its JSON envelope', async () => {
  const cwd = repo();
  const consult = vi.spyOn(brainstorm, 'runBrainstorm').mockResolvedValue({
    exitCode: 0, stdout: '{"response":"Use a streaming reader"}', result: { response: 'Use a streaming reader' },
  });
  const contextSpine = vi.fn(async (_context: unknown) => 'FIRST_TURN_PROJECT_CONTEXT');
  let builds = 0;
  const dispatch = vi.fn(async (engineId, _prompt, context, _options) => {
    writeFileSync(join(context.cwd, 'feature.txt'), 'streaming reader\n');
    return { engineId, exitCode: 0, stdout: ++builds === 1 ? 'CONQUER_ASK: how do I start?'
      : 'CONQUER_DONE: implemented the reader', stderr: '', timedOut: false };
  });
  const services = { conquer: { contextSpine }, logger: { debug: vi.fn() },
    receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder', 'advisor'], dispatch } } as unknown as ModServices;
  const out = await runConquerTask({ task: 'implement reader', gate: 'true', builder: 'builder', engines: 'advisor', maxTurns: '2' },
    { invocationId: 'brainstorm-branch', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(out.exitCode).toBe(0);
  expect(consult).toHaveBeenCalledExactlyOnceWith({ question: 'how do I start?', engines: 'advisor', timeout: '600' },
    expect.objectContaining({ cwd: dispatch.mock.calls[0][2].cwd }), expect.objectContaining({
      engines: services.engines, receipts: services.receipts, logger: services.logger,
      conquer: expect.objectContaining({ contextSpine }),
    }));
  expect(dispatch.mock.calls[1][1]).toContain('[Cesar consulted brainstorm] Use a streaming reader');
  expect(dispatch.mock.calls[1][1]).not.toContain('{"response"');
  expect(contextSpine).toHaveBeenCalledOnce();
  expect(contextSpine.mock.calls[0][0]).toMatchObject({ cwd: dispatch.mock.calls[0][2].cwd });
  expect(dispatch.mock.calls[0][2].cwd).not.toBe(cwd);
  expect(dispatch.mock.calls[0][1]).toContain('FIRST_TURN_PROJECT_CONTEXT');
  expect(dispatch.mock.calls[1][1]).not.toContain('FIRST_TURN_PROJECT_CONTEXT');
});

it.each(['--max-turns -2', '--max-turns 0', '--max-turns invalid', '--max-turns', '--max-hours -0.5', '--max-hours invalid', '--max-hours', '--max-hours Infinity', '--max-turns Infinity', '--max-hours --max-turns 2 3', '--max-hours --builder builder 3'])('rejects TUI budget %s before execution', async option => {
  const dispatch = vi.fn();
  const services = { engines: { listActive: async () => ['builder'], dispatch } } as unknown as ModServices;
  let contribution: CommandContribution | undefined;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'tui') contribution = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  await (await createMod(withConquerHost(services))).activate(registrar);
  const parse = () => contribution!.parse!(`/conquer task --gate "true" ${option}`);
  expect(parse).toThrow(/Invalid --max-(turns|hours)/);
  expect(dispatch).not.toHaveBeenCalled();
});

it.each([
  { option: '--max-hours .5', field: 'maxHours', expected: 0.5 },
  { option: '--max-turns +2', field: 'maxTurns', expected: 2 },
  { option: '--max-turns 2turns', field: 'maxTurns', expected: 2 },
  { option: '--timeout -2', field: 'turnTimeout', expected: 600 },
  { option: '--timeout invalid', field: 'turnTimeout', expected: 600 },
  { option: '--gate-timeout -2', field: 'gateTimeout', expected: 1800 },
  { option: '--gate-timeout invalid', field: 'gateTimeout', expected: 1800 },
  { option: '--max-hours 0', field: 'maxHours', expected: 0 },
  { option: '--timeout', field: 'turnTimeout', expected: 600 },
  { option: '--gate-timeout', field: 'gateTimeout', expected: 1800 },
  { option: '--timeout Infinity', field: 'turnTimeout', expected: 600 },
  { option: '--gate-timeout 0', field: 'gateTimeout', expected: 1800 },
  { option: '--timeout --max-turns 2', field: 'turnTimeout', expected: 600 },
])('consumes the full TUI numeric option $option', async ({ option, field, expected }) => {
  let contribution: CommandContribution | undefined;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'tui') contribution = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  await (await createMod({} as ModServices)).activate(registrar);
  const parsed = await contribution!.parse!(`/conquer task --gate "true" ${option}`);
  const canonical = JSON.parse(JSON.stringify(parsed));
  assertContributionInput(contribution!.inputSchema, canonical);
  expect(canonical).toMatchObject({ task: 'task', [field]: expected });
});

it('does not borrow a missing timeout value from later positional text', async () => {
  let contribution: CommandContribution | undefined;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'tui') contribution = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  await (await createMod({} as ModServices)).activate(registrar);
  expect(await contribution!.parse!('/conquer task --timeout --max-turns 2 3 --gate "true"'))
    .toMatchObject({ task: 'task 3', turnTimeout: 600, maxTurns: 2 });
});

it.each(['', ' --timeout 7'])('keeps numeric flags inside the quoted gate separate from Conquer options: %s', async suffix => {
  let contribution: CommandContribution | undefined;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'tui') contribution = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  await (await createMod({} as ModServices)).activate(registrar);
  const parsed = await contribution!.parse!(`/conquer task --gate "checker --timeout 1 --max-turns 2"${suffix}`);
  const canonical = JSON.parse(JSON.stringify(parsed));
  assertContributionInput(contribution!.inputSchema, canonical);
  expect(canonical).toEqual({ task: 'task', gate: 'checker --timeout 1 --max-turns 2', ...(suffix ? { turnTimeout: 7 } : {}) });
});

it.each(['', ' --push'])('keeps quoted gate --push separate from publication approval: %s', async suffix => {
  let contribution: CommandContribution | undefined;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'tui') contribution = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  await (await createMod({} as ModServices)).activate(registrar);
  const parsed = JSON.parse(JSON.stringify(await contribution!.parse!(`/conquer task --gate "checker --push"${suffix}`)));
  assertContributionInput(contribution!.inputSchema, parsed);
  expect(parsed).toEqual({ task: 'task', gate: 'checker --push', ...(suffix ? { push: true } : {}) });
});

it.each(['max-turns', 'timeout', 'gate-timeout'])('preserves large typed TUI --%s values through execution', async flag => {
  const cwd = repo();
  const fitness = vi.spyOn(verification, 'runFitnessCommand').mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', timedOut: false, durationMs: 1 });
  let calls = 0;
  const dispatch = vi.fn(async (engineId, _prompt, _context, _options) => ({ engineId,
    exitCode: ++calls === 3 ? 1 : 0, stdout: 'CONQUER_DONE: verify the feature', stderr: '', timedOut: false }));
  const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder'], dispatch } } as unknown as ModServices;
  let contribution: CommandContribution | undefined;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'tui') contribution = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  await (await createMod(withConquerHost(services))).activate(registrar);
  const parsed = await contribution!.parse!(`/conquer task --gate "false" --${flag} 1000000000000000000000${flag === 'max-turns' ? '' : ' --max-turns 1'}`);
  const input = JSON.parse(JSON.stringify(parsed));
  assertContributionInput(contribution!.inputSchema, input);
  await contribution!.run(input, { invocationId: 'large-numeric-budget', cwd,
    platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
  expect(dispatch).toHaveBeenCalledTimes(flag === 'max-turns' ? 3 : 1);
  if (flag === 'timeout') expect(dispatch.mock.calls[0][3]).toMatchObject({ timeoutSeconds: 1e21 });
  if (flag === 'gate-timeout') expect(fitness.mock.calls[0][2]).toBe(1e21);
});

it.each(['missing-sentinel', 'empty-claim', 'changed-test', 'deleted-test', 'renamed-test', 'emptied-test', 'new-test', 'new-quoted-test', 'new-empty-test', 'valid-claim', 'red-gate', 'no-diff'] as const)(
  'checks completion evidence for %s', async scenario => {
    const cwd = repo();
    writeFileSync(join(cwd, 'guard.test.ts'), 'throw new Error("must implement feature");\n');
    execFileSync('git', ['add', 'guard.test.ts'], { cwd });
    execFileSync('git', ['commit', '-m', 'frozen test fixture'], { cwd });
    const dispatch = vi.fn(async (engineId, _prompt, context, _options) => {
      if (scenario === 'changed-test') writeFileSync(join(context.cwd, 'guard.test.ts'), '// skipped\n');
      else if (scenario === 'deleted-test') unlinkSync(join(context.cwd, 'guard.test.ts'));
      else if (scenario === 'renamed-test') renameSync(join(context.cwd, 'guard.test.ts'), join(context.cwd, 'guard.ts'));
      else if (scenario === 'emptied-test') writeFileSync(join(context.cwd, 'guard.test.ts'), '');
      else if (scenario === 'new-test') writeFileSync(join(context.cwd, 'new.test.ts'), '// new coverage\n');
      else if (scenario === 'new-quoted-test') writeFileSync(join(context.cwd, 'new\tquoted.test.ts'), '// new coverage\n');
      else if (scenario === 'new-empty-test') writeFileSync(join(context.cwd, 'new.test.ts'), '');
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
    const accepted = ['new-test', 'new-quoted-test', 'new-empty-test', 'valid-claim'].includes(scenario);
    expect(result).toMatchObject({ exitCode: accepted ? 0 : 1,
      result: { status: accepted ? 'completed' : 'turn_budget_exceeded' } });
    const reason = ['changed-test', 'deleted-test', 'renamed-test', 'emptied-test'].includes(scenario) ? 'L1:'
      : scenario === 'missing-sentinel' || scenario === 'empty-claim' ? 'L2:'
      : scenario === 'red-gate' ? 'L0:'
      : scenario === 'no-diff' ? 'No patch'
      : 'oracle-tamper check not performed';
    if (scenario === 'missing-sentinel') {
      expect(result.result).toMatchObject({ turns: [{ turn: 1, gate: null, done: false, agent: expect.anything() }] });
    } else {
      expect(result.result).toMatchObject({ turns: [expect.objectContaining({
        completion: expect.objectContaining({ passed: accepted, reason: expect.stringContaining(reason) }),
      })] });
    }
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
    const result = await run(input, { invocationId: 'explicit-pool', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, withCouncilFixtureHost(withTribunalFixtureHost(services)));
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
    const result = await run(defaultInput, { invocationId: 'default-pool', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, withCouncilFixtureHost(withTribunalFixtureHost(services)));
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
    const questions = ['is this approach wrong?', 'choose 1. first or 2. second', 'is this architecture safe?'];
    let builds = 0;
    const dispatch = vi.fn(async (engineId: string, _prompt: string) => ({ engineId, exitCode: 0,
      stdout: engineId === 'selected-builder' ? `CONQUER_ASK: ${questions[builds++]}` : 'Confidence: 80%\nVERDICT: SOUND',
      stderr: '', timedOut: false }));
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
    expect(dispatch.mock.calls).toEqual(expect.arrayContaining([
      ['selected-a', expect.stringContaining('You are: **Argue FOR**')],
      ['selected-b', expect.stringContaining('You are: **Argue AGAINST**')],
    ].map(([id, prompt]) => expect.arrayContaining([id, prompt]))));
    expect(dispatch.mock.calls.some(([, prompt]) => prompt.startsWith('You are the chairman of an expert council. Before the council debates'))).toBe(true);
    expect(dispatch.mock.calls.some(([, prompt]) => prompt.startsWith('You are the chairman of an expert council. Synthesize the advisors'))).toBe(true);
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
      { invocationId: 'forced-chair', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, withCouncilFixtureHost(services));
    expect(resolveRequested.mock.calls.map(([ids]) => ids)).toEqual([['alias-a', 'alias-b'], ['alias-b']]);
    if (rejected) {
      expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('Chair unavailable') });
      expect(dispatch).not.toHaveBeenCalled();
      expect(rank).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    } else {
      expect(result).toMatchObject({ exitCode: 0, result: { chairmanId: 'selected-b', chairmanReason: 'forced' } });
      expect(dispatch.mock.calls.filter(([, prompt]) => prompt.startsWith('You are the chairman of an expert council. Before the council debates') || prompt.startsWith('You are the chairman of an expert council. Synthesize the advisors')).map(([id]) => id)).toEqual(['selected-b', 'selected-b']);
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
    // Ordinary output does not request a consultation.
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
    const arena = vi.spyOn(fixtureWorktrees, 'createSessionWorktree');
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
  const arena = vi.spyOn(fixtureWorktrees, 'createSessionWorktree');
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
  vi.spyOn(worktrees, 'readWorktreePatch').mockReturnValue('');
  const fitness = vi.spyOn(verification, 'runFitnessCommand').mockResolvedValue({
    exitCode: 1, stdout: '', stderr: '', timedOut: false, durationMs: 1,
  });
  const started = Date.now();
  const dispatch = vi.fn(async engineId => {
    if (input.maxHours !== undefined) vi.spyOn(Date, 'now').mockReturnValue(started + 3_600_000);
    return { engineId, exitCode: 0, stdout: 'CONQUER_DONE: check current work', stderr: '', timedOut: false };
  });
  const services = { logger: { debug: vi.fn() }, receipts: { record: vi.fn(async () => 'fixture') },
    engines: { listActive: async () => ['builder'], dispatch } } as unknown as ModServices;
  const result = await runConquerTask({ task: 'build feature', gate: 'false', builder: 'builder', ...input },
    { invocationId: 'legacy-budget', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} }, services);
  expect(result).toMatchObject({ exitCode: 1, result: { status: input.maxHours === '0.5hours' ? 'time_budget_exceeded' : 'turn_budget_exceeded' } });
  expect(dispatch).toHaveBeenCalledTimes(turns);
  expect(fitness).toHaveBeenCalledTimes(turns);
  expect(existsSync((result.result as any).worktree.path)).toBe(true);
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
  const questions = ['is this approach wrong?', 'choose 1. first or 2. second', 'is this architecture safe?'];
  let builds = 0;
  const dispatch = vi.fn(async (engineId, _prompt, _context, _options) => ({ engineId, exitCode: 0,
    stdout: `CONQUER_ASK: ${questions[builds++]}`, stderr: '', timedOut: false }));
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
    engineId, exitCode: 0, stdout: options.mode === 'agent' ? 'CONQUER_ASK: is this approach wrong?' : 'Confidence: 80%\nVERDICT: SOUND',
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
  expect(paths.every(path => existsSync(path))).toBe(true);
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
  for (const consult of consults) expect(consult).not.toHaveBeenCalled();
  expect(record).toHaveBeenCalledWith('conquer', expect.objectContaining({ status: 'cancelled', turns: expect.arrayContaining([expect.objectContaining({ turn: cancelTurn, done: false })]) }));
  expect(paths.every(path => existsSync(path))).toBe(true);
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
      stdout: 'CONQUER_DONE: verify partial work', stderr: 'fixture failure', timedOut: paths.length === 2 && scenario === 'timed-out' };
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
  expect(consult).not.toHaveBeenCalled();
  expect(record).toHaveBeenCalledWith('conquer', expect.objectContaining({ status: 'builder_failed' }));
  expect(paths.every(path => existsSync(path))).toBe(true);
});

it.each(['tui', 'argument-only', 'direct', 'canonical-precedence', 'deadline'] as const)('preserves %s turn, timeout and advisor selections', async (entry) => {
  const cwd = repo();
  const fitness = vi.spyOn(verification, 'runFitnessCommand');
  const started = Date.now();
  const dispatch = vi.fn(async (engineId, _prompt, _context, _options) => {
    if (entry === 'deadline') vi.spyOn(Date, 'now').mockReturnValue(started + 3_600_000);
    return { engineId, exitCode: 0, stdout: 'CONQUER_DONE: check current work', stderr: '', timedOut: false };
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
  await (await createMod(withConquerHost(services))).activate(registrar);
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
describe('physical conquer mod',()=>{it('iterates in one isolated worktree until the gate, then receipts the patch and retains review work',async()=>{const cwd=repo();let agentTurns=0;const paths:string[]=[];const dispatch=vi.fn(async(id:string,prompt:string,context:any,options:any)=>{if(options.mode==='agent'){agentTurns++;paths.push(context.cwd);if(agentTurns===2)writeFileSync(join(context.cwd,'solved.txt'),'yes\n');return{id,exitCode:0,stdout:agentTurns===2?'CONQUER_DONE: solved.txt contains the requested result':'worked',stderr:'',timedOut:false};}return{id,exitCode:0,stdout:'VERDICT: CONTINUE\nCONFIDENCE: 80',stderr:'',timedOut:false};});const services={identity:{id:'agon.conquer',version:'1',contentHash:`sha256:${'a'.repeat(64)}`},source:'bundled',logger:{debug:vi.fn(),info:vi.fn(),warn:vi.fn()},receipts:{record:vi.fn(async()=>'conquer-r')},permissions:{check:vi.fn()},state:{read:vi.fn(),write:vi.fn()},engines:{listActive:vi.fn(async()=>['builder','a','b']),rank:vi.fn(async(ids:readonly string[])=>ids.map(engineId=>({engineId,reason:'none',scope:null}))),dispatch}}as unknown as ModServices;const out=await runConquerTask({task:'solve',gate:'test -f solved.txt',builder:'builder',engines:'a,b',maxTurns:'3'}, {invocationId:'c',cwd,platform:'darwin-arm64',signal:new AbortController().signal,config:{}},services);expect(out.exitCode).toBe(0);expect((out.result as any).turns).toHaveLength(2);expect((out.result as any).winningPatch).toContain('solved.txt');expect(existsSync(join(cwd,'solved.txt'))).toBe(false);expect(paths.every(path=>existsSync(path))).toBe(true);});});
