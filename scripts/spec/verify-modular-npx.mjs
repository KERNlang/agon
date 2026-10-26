import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyPackedMcp } from './verify-packed-mcp.mjs';
import { verifyPackedBrainstorm } from './verify-packed-brainstorm.mjs';
import { verifyPackedBrainstormTui } from './verify-packed-brainstorm-tui.mjs';
import { createFrozenNpmInstall, DurableModHost, ManagedLifecycleService, hashInstalledPackagePayload } from '../../packages/mod-kernel/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'docs/specs/evidence/modular-agon-npx-qualification.json');
const release = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-release-set.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'agon-s9-npx-'));
const packRoot = join(scratch, 'tarballs');
const ephemeral = join(scratch, 'ephemeral-npx-cache');
const home = join(scratch, 'Agon Home ü with spaces');
const npmCache = process.env.AGON_S9_NPM_CACHE || '/private/tmp/agon-s8-npm-cache-ba8c411f';
const checks = [];
const run = (executable, args, options = {}) => spawnSync(executable, args, { cwd: options.cwd ?? root, encoding: 'utf8', timeout: options.timeout ?? 15 * 60_000,
  env: { ...process.env, npm_config_ignore_scripts: 'true', npm_config_cache: npmCache, npm_config_logs_dir: join(scratch, 'npm-logs'), ...options.env } });
const requireOk = (id, result) => {
  const passed = result.status === 0 && !result.error && !result.signal;
  checks.push({ id, passed, detail: passed ? 'exit=0' : `exit=${result.status} signal=${result.signal ?? 'none'} error=${result.error ?? ''} stderr=${String(result.stderr).slice(0, 1200)}` });
  if (!passed) throw new Error(checks.at(-1).detail);
  return result;
};
const makeRemovable = (path) => {
  if (!existsSync(path)) return;
  try { chmodSync(path, 0o700); } catch { /* rmSync reports unrecoverable permissions */ }
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    try {
      const info = lstatSync(child);
      // chmod follows symlinks: applying file permissions to a linked run
      // directory removes traversal permission and makes cleanup fail.
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) makeRemovable(child);
      else chmodSync(child, 0o600);
    } catch { /* rmSync reports unrecoverable permissions */ }
  }
};

mkdirSync(packRoot, { recursive: true });
try {
  const tarballs = {};
  const artifacts = {};
  for (const pkg of [...release.packages, ...release.compatibilityArtifacts]) {
    const result = requireOk(`pack:${pkg.id}`, run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packRoot], { cwd: join(root, pkg.directory) }));
    const packed = JSON.parse(result.stdout)[0];
    tarballs[pkg.id] = join(packRoot, packed.filename);
    artifacts[pkg.id] = { version: pkg.version, resolved: `file:${tarballs[pkg.id]}`, integrity: packed.integrity };
  }
  const cliPack = requireOk('pack:@kernlang/agon', run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packRoot], { cwd: join(root, 'packages/cli') }));
  const launcherTarball = join(packRoot, JSON.parse(cliPack.stdout)[0].filename);
  artifacts['@kernlang/agon'] = { version: release.version, resolved: `file:${launcherTarball}`, integrity: JSON.parse(cliPack.stdout)[0].integrity };
  mkdirSync(ephemeral, { recursive: true });
  const channel = JSON.parse(readFileSync(join(root, 'packages/cli/release-channel.json'), 'utf8'));
  const frozen = createFrozenNpmInstall(channel.npmCatalog, Object.keys(artifacts), artifacts);
  writeFileSync(join(ephemeral, 'package.json'), JSON.stringify(frozen.manifest, null, 2));
  const lockBytes = JSON.stringify(frozen.lock, null, 2);
  writeFileSync(join(ephemeral, 'package-lock.json'), lockBytes);
  requireOk('ephemeral-npx-hydration', run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=optional', '--offline'], { cwd: ephemeral }));
  if (readFileSync(join(ephemeral, 'package-lock.json'), 'utf8') !== lockBytes) throw new Error('packed hydration changed the frozen dependency lock');
  requireOk('packed-agent-team-scoring-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { scoreAgentTeamResult } from '@kernlang/agon-mod-agent';
    assert.ok(import.meta.resolve('@kernlang/agon-mod-agent').startsWith(pathToFileURL(process.cwd() + '/node_modules/').href));
    const team = { members: [{ engineId: 'worker', worktreePath: '/fixture', error: null,
      stepResult: { response: 'x'.repeat(51), toolCalls: 1, innerSteps: 1, tokensUsed: 2, costUsd: 0, stopReason: 'completed' }
    }], runId: 'fixture', baseSha: 'base', durationMs: 1500, succeeded: 1, failed: 0 };
    const read = (cwd, base) => { assert.equal(cwd, '/fixture'); assert.equal(base, 'base'); return { filesChanged: 1, linesChanged: 2 }; };
    assert.equal(scoreAgentTeamResult(team, 'edit', undefined, read).get('worker').pass, false);
    const result = scoreAgentTeamResult(team, 'edit', new Map([['worker', true]]), read).get('worker');
    assert.equal(result.pass, true); assert.equal(result.score, 100); assert.equal(result.durationSec, 2);
    assert.equal(scoreAgentTeamResult(team, 'investigate', undefined, () => { throw new Error('unexpected Git read'); }).get('worker').pass, true);
  `], { cwd: ephemeral }));
  const agentTypes = join(ephemeral, 'agent-team-types.mts');
  writeFileSync(agentTypes, `import { scoreAgentTeamResult, type AgentTeamResult, type AgentTeamMemberResult, type AgentTeamScore, type AgentTeamShortstatReader } from '@kernlang/agon-mod-agent';
    const member: AgentTeamMemberResult = { engineId: 'worker', worktreePath: null, error: null,
      stepResult: { response: 'answer', toolCalls: 1, innerSteps: 1, tokensUsed: 1, costUsd: 0, stopReason: 'completed' } };
    const team: AgentTeamResult = { members: [member], runId: 'run', baseSha: 'base', durationMs: 0, succeeded: 0, failed: 1 };
    const read: AgentTeamShortstatReader = () => ({ filesChanged: 0, linesChanged: 0 });
    const result: Map<string, AgentTeamScore> = scoreAgentTeamResult(team, 'edit', undefined, read);
    void result;
    // @ts-expect-error Unsupported task kinds must not cross this boundary.
    scoreAgentTeamResult(team, 'unknown', undefined, read);
    // @ts-expect-error Nested result fields must retain their types.
    const invalid: AgentTeamMemberResult = { ...member, stepResult: { ...member.stepResult!, toolCalls: 'one' } };
    void invalid;
  `);
  requireOk('packed-agent-team-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', agentTypes], { cwd: ephemeral }));
  const coreTypes = join(scratch, 'core-agent-team-types.mts');
  writeFileSync(coreTypes, `import { scoreAgentTeamResult, type AgentTeamResult, type AgentTeamMemberResult, type EngineResult } from ${JSON.stringify(join(root, 'packages/core/dist/index.js'))};
    const member: AgentTeamMemberResult = { engineId: 'worker', worktreePath: null, error: null,
      stepResult: { response: 'answer', toolCalls: 1, innerSteps: 1, tokensUsed: 1, costUsd: 0, stopReason: 'completed' } };
    const team: AgentTeamResult = { members: [member], runId: 'run', baseSha: 'base', durationMs: 0, succeeded: 1, failed: 0 };
    const result: Map<string, EngineResult> = scoreAgentTeamResult(team, '/fixture', 'edit', new Map());
    void result;
    // @ts-expect-error The legacy public signature still requires a repository path.
    scoreAgentTeamResult(team, 'edit', new Map());
  `);
  requireOk('compiled-core-agent-team-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', coreTypes], { cwd: scratch }));
  requireOk('packed-shared-git-diff-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import * as worktree from '@kernlang/agon-support-worktree';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    assert.ok(import.meta.resolve('@kernlang/agon-support-worktree').startsWith(installedRoot), 'shared owner must resolve from the installed prefix');
    for (const name of ['isTestFile', 'parseChangedLines', 'newFilesInDiff']) {
      assert.equal(typeof worktree[name], 'function', name);
    }
    assert.equal(worktree.isTestFile('tests/example.test.ts'), true);
    assert.equal(worktree.isTestFile('src/example.ts'), false);
    const diff = ['--- /dev/null', '+++ b/tests/example.test.ts', '@@ -0,0 +1,2 @@', '+first', '+second'].join('\\n');
    assert.deepEqual(worktree.parseChangedLines(diff), { 'tests/example.test.ts': [1, 2] });
    assert.deepEqual(worktree.newFilesInDiff(diff), ['tests/example.test.ts']);
  `], { cwd: ephemeral }));
  requireOk('packed-provenance-report-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    import { spawnSync } from 'node:child_process';
    import * as reports from '@kernlang/agon-mod-provenance';
    assert.ok(import.meta.resolve('@kernlang/agon-mod-provenance').startsWith(pathToFileURL(process.cwd() + '/node_modules/').href));
    const manifest = { forgeId: 'report', task: 'fixture task', timestamp: '2026',
      engines: ['a', 'b'], winner: 'a', fitnessCmd: 'npm test\\nnpm run typecheck',
      results: { a: { score: 9, pass: true }, b: { score: 4, pass: false } },
      dispatchLog: [{ engineId: 'a', tokens: { costUsd: 0 } }],
      synthesis: { wins: true, score: 10, pass: true, originalWinnerScore: 9 } };
    const reportHome = join(process.cwd(), 'report-home');
    mkdirSync(join(reportHome, 'runs'), { recursive: true });
    const source = join(reportHome, 'runs', 'report.json');
    writeFileSync(source, JSON.stringify(manifest));
    const ledger = reports.buildForgeProvenance(manifest, source);
    assert.equal(ledger.contributions[0].costUsd, 0);
    assert.equal(ledger.sourceHashes['manifest.json'], reports.sha256OfFile(source));
    assert.equal(JSON.parse(reports.renderProvenanceJson(ledger)).winner, 'a');
    assert.equal(reports.renderMarkdown, reports.renderProvenanceMarkdown);
    const markdown = reports.writeProvenanceReport(manifest, source, join(reportHome, 'output'), 'both');
    assert.ok(readFileSync(markdown, 'utf8').includes('**Winner:**'));
    assert.ok(readFileSync(markdown, 'utf8').includes('*synthesis blend*'));
    const cli = join(process.cwd(), 'node_modules/@kernlang/agon/dist/index.js');
    const output = spawnSync(process.execPath, [cli, 'provenance', '--id', 'report', '--format', 'md'],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 30000, env: { ...process.env, AGON_HOME: reportHome } });
    assert.equal(output.status, 0, output.stderr);
    assert.ok(output.stdout.includes('**Winner:**'));
    assert.ok(output.stdout.includes('*synthesis blend*'));
    assert.ok(output.stdout.includes('npm test npm run typecheck'));
  `], { cwd: ephemeral }));
  const provenanceExample = join(ephemeral, 'provenance-public-contract.mts');
  writeFileSync(provenanceExample, `
    import { buildForgeProvenance, buildProvenance, renderProvenanceMarkdown, renderMarkdown,
      renderProvenanceJson, writeProvenanceReport, type ProvenanceLedger, type ProvenanceManifest,
      type ProvenanceContribution } from '@kernlang/agon-mod-provenance';
    const input: ProvenanceManifest = { forgeId: 'id', task: 'task', timestamp: '2026' };
    const ledger: ProvenanceLedger = buildForgeProvenance(input, 'manifest.json');
    const physical: ProvenanceLedger = buildProvenance(input, 'manifest.json');
    const contribution: ProvenanceContribution | undefined = ledger.contributions[0];
    const outputs: string[] = [renderProvenanceMarkdown(ledger), renderMarkdown(physical),
      renderProvenanceJson(ledger), writeProvenanceReport(input, 'manifest.json', 'output', 'both')];
    // @ts-expect-error Unknown autonomy labels must not cross the public contract.
    const invalid: ProvenanceLedger['autonomyLevel'] = 'invented';
    void outputs; void contribution; void invalid;
  `);
  requireOk('packed-provenance-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), provenanceExample], { cwd: ephemeral }));
  requireOk('packed-synthesis-runtime', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { runSynthesisRuntime, buildSynthesisDraftPrompt } from '@kernlang/agon-mod-synthesis';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    assert.ok(import.meta.resolve('@kernlang/agon-mod-synthesis').startsWith(installedRoot));
    assert.match(buildSynthesisDraftPrompt('Design'), /^## SYNTHESIS DRAFT/);
    const calls = [], events = [];
    const result = await runSynthesisRuntime({
      prompt: 'Design', engines: ['alpha', 'beta'], swaps: 1, timeout: 10,
      outputDir: process.cwd(), registry: { get: id => ({ id }), findBinary: () => null },
      adapter: { dispatch: async request => {
        calls.push(request);
        return { stdout: request.prompt.startsWith('## SYNTHESIS JUDGE')
          ? 'SCORE_1: 80\\nSCORE_2: 60\\nWINNER: alpha\\nREASONING: fixture'
          : 'fixture draft', stderr: '', exitCode: 0, timedOut: false };
      } }, onEvent: event => events.push(event),
    }, { resolveWorkingDir: () => process.cwd(), health: { loadConfig: () => ({}) },
      warn: message => { throw new Error(message); } });
    assert.equal(calls.length, 4);
    assert.ok(calls.every(request => request.textOnly === true));
    assert.equal(result.drafts.length, 2);
    assert.equal(result.swaps.length, 1);
    assert.equal(result.winner, 'alpha');
    assert.deepEqual(events.map(event => event.type), ['synthesis:draft', 'synthesis:draft', 'synthesis:swap', 'synthesis:score']);
  `], { cwd: ephemeral, env: { AGON_FORCE_HEALTH_PROBE: '', AGON_DISABLE_FORGE_HEALTH_CHECK: '1' } }));
  const synthesisExample = join(ephemeral, 'synthesis-public-contract.mts');
  writeFileSync(synthesisExample, `
    import { runSynthesisRuntime, type SynthesisRuntimeOptions, type SynthesisRuntimeEffects,
      type SynthesisResult, type SynthesisRuntimeEvent } from '@kernlang/agon-mod-synthesis';
    declare const options: SynthesisRuntimeOptions;
    declare const effects: SynthesisRuntimeEffects;
    const result: Promise<SynthesisResult> = runSynthesisRuntime(options, effects);
    const event: SynthesisRuntimeEvent = { type: 'synthesis:draft', engineId: 'fixture', data: { round: 0 } };
    void result; void event;
  `);
  requireOk('packed-synthesis-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), synthesisExample], { cwd: ephemeral }));
  requireOk('packed-agent-refinement', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { runAgentTeamSynthesis, runAgentInvestigateSynthesis } from '@kernlang/agon-mod-agent';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    assert.ok(import.meta.resolve('@kernlang/agon-mod-agent').startsWith(installedRoot));
    const calls = [];
    const runtime = {
      runApiAgentLoop: async options => {
        calls.push('api');
        assert.equal(options.cwd, process.cwd());
        return { response: 'refined report', toolCalls: 0, steps: 1 };
      },
      recordApiLoopDispatch: () => { calls.push('ledger'); },
      worktreeChangedDiff: () => { calls.push('diff'); return 'refined patch'; },
    };
    const options = { task: 'fixture', winnerEngineId: 'winner',
      winnerApi: { baseUrl: 'https://example.invalid', apiKeyEnv: 'FIXTURE_KEY', model: 'fixture' },
      winnerWorktreePath: process.cwd(), winnerCwd: process.cwd(), winnerDiff: 'original patch',
      winnerResponse: 'original report', baseSha: 'fixture', timeout: 1,
      losers: [{ engineId: 'other', diff: 'other patch', response: 'other report', passedFitness: true }] };
    assert.deepEqual(await runAgentTeamSynthesis(options, runtime), {
      ok: true, synthesizedDiff: 'refined patch', changed: true, error: null, responseExcerpt: 'refined report', skipped: false,
    });
    assert.deepEqual(await runAgentInvestigateSynthesis(options, runtime), {
      ok: true, report: 'refined report', error: null, skipped: false,
    });
    assert.deepEqual(calls, ['api', 'ledger', 'diff', 'api', 'ledger']);
  `], { cwd: ephemeral }));
  const agentExample = join(ephemeral, 'agent-refinement-public-contract.mts');
  writeFileSync(agentExample, `
    import { runAgentTeamSynthesis, runAgentInvestigateSynthesis, type AgentSynthesisOptions,
      type AgentSynthesisResult, type AgentInvestigateSynthesisOptions,
      type AgentInvestigateSynthesisResult, type AgentSynthesisRuntime } from '@kernlang/agon-mod-agent';
    declare const options: AgentSynthesisOptions;
    declare const investigation: AgentInvestigateSynthesisOptions;
    declare const runtime: AgentSynthesisRuntime;
    const edit: Promise<AgentSynthesisResult> = runAgentTeamSynthesis(options, runtime);
    const report: Promise<AgentInvestigateSynthesisResult> = runAgentInvestigateSynthesis(investigation, runtime);
    void edit; void report;
  `);
  requireOk('packed-agent-refinement-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), agentExample], { cwd: ephemeral }));
  requireOk('packed-agent-events', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import * as agent from '@kernlang/agon-mod-agent';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    assert.ok(import.meta.resolve('@kernlang/agon-mod-agent').startsWith(installedRoot));
    assert.deepEqual(agent.makeAssistantChunk('engine', 'hello'), { kind: 'assistant_chunk', engineId: 'engine', text: 'hello' });
    assert.deepEqual(agent.makeError('engine', 'failed'), { kind: 'error', engineId: 'engine', message: 'failed', recoverable: false });
    assert.deepEqual(agent.makeTurnComplete('engine', 'end_turn'), { kind: 'turn_complete', engineId: 'engine', stopReason: 'end_turn', usage: null });
    const rejected = agent.normalizeSessionChunk({ type: 'tool_call', content: 'shell', metadata: { status: 'denied', toolCallId: 'id' } }, 'engine');
    assert.deepEqual(rejected, agent.makeToolCall('engine', 'shell', 'rejected', { toolCallId: 'id', terminalReason: 'denied' }));
    assert.equal(agent.normalizeSessionChunk({ type: 'status', content: 'busy' }, 'engine'), null);
    assert.deepEqual(agent.unavailableUsage(), { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'unavailable' });
    assert.deepEqual(agent.estimatedUsage('12345', '1234'), { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'estimated' });
    assert.deepEqual(agent.buildApiTurnEvents('engine', '', 0, 'end_turn'), [agent.makeTurnComplete('engine', 'end_turn')]);
  `], { cwd: ephemeral }));
  const agentEventExample = join(ephemeral, 'agent-events-public-contract.mts');
  writeFileSync(agentEventExample, `
    import { makeAssistantChunk, makeToolCall, makeTurnComplete, makeError, normalizeSessionChunk,
      buildApiTurnEvents, unavailableUsage, estimatedUsage, type AgentEvent, type AgentUsage,
      type RawSessionChunk } from '@kernlang/agon-mod-agent';
    const usage: AgentUsage = estimatedUsage('prompt', 'reply');
    const chunk: RawSessionChunk = { type: 'tool_call', content: 'shell', metadata: { status: 'done' } };
    const events: AgentEvent[] = [makeAssistantChunk('engine', 'hello'), makeToolCall('engine', 'shell', 'ok'),
      makeTurnComplete('engine', 'end_turn', usage), makeError('engine', 'failed'),
      ...buildApiTurnEvents('engine', '', 0, 'end_turn', unavailableUsage())];
    const normalized: AgentEvent | null = normalizeSessionChunk(chunk, 'engine');
    for (const event of events) {
      switch (event.kind) {
        case 'assistant_chunk': event.text satisfies string; break;
        case 'tool_call': event.status satisfies 'running' | 'ok' | 'error' | 'rejected'; break;
        case 'turn_complete': event.usage satisfies AgentUsage | null; break;
        case 'error': event.recoverable satisfies boolean; break;
        default: event satisfies never;
      }
    }
    // @ts-expect-error Unknown event kinds must not cross the public boundary.
    const invalid: AgentEvent = { kind: 'unknown', engineId: 'engine' };
    void normalized; void invalid;
  `);
  requireOk('packed-agent-events-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), agentEventExample], { cwd: ephemeral }));
  // Independent probes must not hide later installer failures. Retain every
  // failed check and reject the whole qualification before emitting success.
  for (const [id, verify] of [
    ['packed-mcp', () => verifyPackedMcp(ephemeral, scratch, { ...process.env, npm_config_cache: npmCache })],
    ['packed-brainstorm', () => verifyPackedBrainstorm(ephemeral, scratch, { ...process.env, npm_config_cache: npmCache })],
    ['packed-brainstorm-tui', () => verifyPackedBrainstormTui(ephemeral, scratch, { ...process.env, npm_config_cache: npmCache })],
    ['packed-brainstorm-tui-active-exit', () => verifyPackedBrainstormTui(ephemeral, scratch, { ...process.env, npm_config_cache: npmCache }, { activeExit: true })],
  ]) {
    try { checks.push(await verify()); }
    catch (error) { checks.push({ id, passed: false, detail: String(error) }); }
  }
  const overrideFile = join(scratch, 'package-specs.json');
  writeFileSync(overrideFile, JSON.stringify(tarballs, null, 2));
  const cli = join(ephemeral, 'node_modules', '@kernlang', 'agon', 'dist', 'index.js');
  const setupEnv = { AGON_HOME: home, AGON_MODULAR_HOST_ROOT: join(home, 'modular-host'), AGON_SETUP_PACKAGE_SPECS_FILE: overrideFile,
    AGON_SETUP_LAUNCHER_SPEC: launcherTarball, AGON_S9_NPM_CACHE: npmCache };
  const first = requireOk('npx-setup-first-run', run(process.execPath, [cli, 'setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: setupEnv }));
  const firstJson = JSON.parse(first.stdout);
  if (firstJson.status !== 'installed' || firstJson.packageCount !== 15 || firstJson.generation !== 1) throw new Error('first setup result is not the exact expected installation');
  checks.push({ id: 'first-run-result', passed: true, detail: 'installed generation 1 with 15-package closure' });
  const stable = join(home, 'bin', 'agon');
  const smoke = requireOk('persistent-launcher-before-cache-delete', run(stable, ['--version'], { cwd: scratch, env: { AGON_HOME: home } }));
  if (!smoke.stdout.includes('1.0.0')) throw new Error('persistent launcher did not report version 1.0.0');
  makeRemovable(ephemeral); rmSync(ephemeral, { recursive: true, force: true });
  checks.push({ id: 'ephemeral-cache-deleted', passed: !existsSync(ephemeral), detail: 'ephemeral npx hydration removed' });
  requireOk('persistent-launcher-after-cache-delete', run(stable, ['--version'], { cwd: scratch, env: { AGON_HOME: home } }));
  const second = requireOk('idempotent-second-setup', run(stable, ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: { ...setupEnv, AGON_SETUP_PACKAGE_SPECS_FILE: overrideFile } }));
  const secondJson = JSON.parse(second.stdout);
  if (secondJson.status !== 'already-qualified' || secondJson.generationUnchanged !== true) throw new Error('second setup was not idempotent');
  checks.push({ id: 'idempotence-result', passed: true, detail: 'generation unchanged' });
  requireOk('managed-mod-list', run(stable, ['mod', 'list'], { cwd: scratch, env: { AGON_HOME: home } }));
  // Exercise the installed launcher, citty parent/child dispatch, durable lock
  // selection, and a NEW process after each mutation. Calling modCommand.run
  // directly cannot detect stale-parent or fresh-bootstrap failures.
  for (const action of ['disable', 'enable']) {
    const preview = JSON.parse(requireOk(`installed-${action}-preview`, run(stable, ['mod', action, 'agon.think'], { cwd: scratch, env: setupEnv })).stdout);
    requireOk(`installed-${action}-apply`, run(stable, ['mod', action, preview.planPath, '--approve', preview.planHash], { cwd: scratch, env: setupEnv }));
    requireOk(`installed-${action}-fresh-start`, run(stable, ['mod', 'list'], { cwd: scratch, env: setupEnv }));
    // citty renders ROOT help successfully for an unknown command with --help.
    // A no-argument invocation distinguishes absence from the enabled handler's
    // missing-problem validation without ever dispatching a model.
    const help = run(stable, action === 'enable' ? ['think', '--help'] : ['think'], { cwd: scratch, env: setupEnv });
    if (action === 'enable') requireOk('re-enabled-think-help', help);
    else {
      const passed = help.status === 1 && /unknown command|unavailable/i.test(help.stderr + help.stdout);
      checks.push({ id: 'disabled-think-unreachable', passed, detail: String(help.stderr + help.stdout).slice(0, 1200) });
      if (!passed) throw new Error('disabled Think is still reachable or failed for an unrelated reason');
    }
  }
  const afterActivation = JSON.parse(requireOk('setup-after-activation', run(stable,
    ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: setupEnv })).stdout);
  if (afterActivation.status !== 'already-qualified') throw new Error('activation lost its qualified installation lineage');
  const host = new DurableModHost(join(home, 'modular-host'), { kernelVersion: release.version });
  const lifecycle = new ManagedLifecycleService(host);
  const previous = await lifecycle.readSelectedInstallation();
  const previousPointer = await host.readCurrentPointer();
  if (!previous || !previousPointer) throw new Error('installed dependency control has no selected installation');
  const dependencyLocation = 'node_modules/semver';
  const dependency = join(host.root, previous.prefix, dependencyLocation, 'package.json');
  // This is an owned disposable installation. Change only JSON whitespace.
  chmodSync(dependency, 0o600);
  writeFileSync(dependency, readFileSync(dependency, 'utf8') + '\n');
  const repaired = JSON.parse(requireOk('setup-rejects-modified-dependency', run(stable,
    ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: setupEnv })).stdout);
  const selected = await lifecycle.readSelectedInstallation();
  if (repaired.status !== 'installed' || repaired.generation !== previousPointer.generation + 1
    || !selected || selected.prefix === previous.prefix
    || await hashInstalledPackagePayload(join(host.root, selected.prefix, dependencyLocation)) !== channel.npmPayloads[dependencyLocation]) {
    throw new Error('modified dependency was reused or replacement was not verified');
  }
  checks.push({ id: 'modified-dependency-requalified', passed: true,
    detail: 'changed retained semver payload forces fresh prefix; new selected payload matches frozen archive identity' });
  const repairedReuse = JSON.parse(requireOk('repaired-installation-reuse', run(stable,
    ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: setupEnv })).stdout);
  if (repairedReuse.status !== 'already-qualified') throw new Error('repaired installation was not reusable');
  // Full compatibility includes 36 mods and 48 packages. The 49th release
  // package is disabled SaaS support, not a default profile dependency.
  for (const [id, profile, withMods, expectedStatus, packageCount] of [
    ['full-profile-install', 'full-compat', null, 'installed', 48],
    ['full-profile-reuse', 'full-compat', null, 'already-qualified', 48],
    ['small-profile-return', 'minimal', 'think,review', 'installed', 15],
    ['small-profile-reuse', 'minimal', 'think,review', 'already-qualified', 15],
  ]) {
    const response = JSON.parse(requireOk(id, run(stable,
      ['setup', '--profile', profile, ...(withMods ? ['--with', withMods] : []), '--offline', '--cache', npmCache, '--json'],
      { cwd: scratch, env: setupEnv })).stdout);
    if (response.status !== expectedStatus || response.packageCount !== packageCount) throw new Error(`${id}: incorrect installation/reuse result`);
    const pointer = await host.readCurrentPointer();
    const desired = pointer && await host.readGenerationDesiredState(pointer);
    if (!desired || desired.selected.length !== (profile === 'full-compat' ? 36 : 3)) throw new Error(`${id}: incorrect selected mod set`);
    checks.push({ id: `${id}-result`, passed: true, detail: `${expectedStatus}; ${packageCount} packages; ${desired.selected.length} selected mods` });
  }
  const provenanceSetup = JSON.parse(requireOk('provenance-profile-install', run(stable,
    ['setup', '--profile', 'minimal', '--with', 'provenance', '--offline', '--cache', npmCache, '--json'],
    { cwd: scratch, env: setupEnv })).stdout);
  if (provenanceSetup.status !== 'installed') throw new Error('Provenance profile was not selected');
  const provenanceInstallation = await lifecycle.readSelectedInstallation();
  if (!provenanceInstallation) throw new Error('Provenance installation is missing');
  const provenancePrefix = join(host.root, provenanceInstallation.prefix);
  const hasProvenance = provenanceInstallation.packages.some(pkg => pkg.id === '@kernlang/agon-mod-provenance');
  const hasForge = provenanceInstallation.packages.some(pkg => pkg.id === '@kernlang/agon-mod-forge');
  if (!hasProvenance || hasForge || existsSync(join(provenancePrefix, 'node_modules/@kernlang/agon-mod-forge'))) {
    throw new Error('Provenance profile must contain Provenance without an installed Forge package');
  }
  checks.push({ id: 'provenance-without-forge-package', passed: true,
    detail: 'selected installation includes Provenance; Forge absent from its package record and node_modules' });
  mkdirSync(join(home, 'runs'), { recursive: true });
  writeFileSync(join(home, 'runs', 'historical-forge.json'), JSON.stringify({
    forgeId: 'historical-forge', task: 'read historical Forge output', timestamp: '2026',
    engines: ['a', 'b'], winner: 'a', fitnessCmd: 'npm test',
    results: { a: { score: 9, pass: true }, b: { score: 4, pass: false } },
    dispatchLog: [{ engineId: 'a', tokens: { costUsd: 0 } }],
    synthesis: { wins: true, score: 10, pass: true, originalWinnerScore: 9 },
  }));
  const provenanceMarkdown = requireOk('provenance-without-forge-markdown', run(stable,
    ['provenance', '--id', 'historical-forge', '--format', 'md'], { cwd: scratch, env: setupEnv })).stdout;
  if (!provenanceMarkdown.includes('**Winner:**') || !provenanceMarkdown.includes('*synthesis blend*')) {
    throw new Error('historical Forge report lost its disclosure without Forge installed');
  }
  const provenanceJson = JSON.parse(requireOk('provenance-without-forge-json', run(stable,
    ['provenance', '--id', 'historical-forge', '--format', 'json'], { cwd: scratch, env: setupEnv })).stdout);
  if (provenanceJson.winner !== 'a' || provenanceJson.contributions[0]?.costUsd !== 0) {
    throw new Error('historical Forge ledger changed without Forge installed');
  }
  const afterProvenance = JSON.parse(requireOk('return-after-provenance-profile', run(stable,
    ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'],
    { cwd: scratch, env: setupEnv })).stdout);
  if (afterProvenance.status !== 'installed' || afterProvenance.packageCount !== 15) {
    throw new Error('small profile could not be restored after Provenance qualification');
  }
  if (checks.some(check => !check.passed)) throw new Error(`packed workflow qualification failed: ${checks.filter(check => !check.passed).map(check => check.id).join(', ')}`);
  const result = { schemaVersion: 1, slice: 'S9', passed: checks.every(({ passed }) => passed), platform: `${process.platform}-${process.arch}`, node: process.version,
    profile: 'minimal+think+review', installedPackageCount: firstJson.packageCount, cacheDeletionSurvived: true, idempotent: true, checks };
  // Scratch cleanup is part of successful qualification. Retry transient
  // ENOTEMPTY/EBUSY failures, but never publish a green receipt before it ends.
  makeRemovable(scratch);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  if (!process.argv.includes('--no-write')) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, installedPackageCount: firstJson.packageCount, cacheDeletionSurvived: true, idempotent: true }, null, 2));
} catch (error) {
  const failure = { schemaVersion: 1, slice: 'S9', passed: false, platform: `${process.platform}-${process.arch}`, node: process.version,
    scratch, error: String(error), checks };
  if (!process.argv.includes('--no-write')) writeFileSync(output, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify(failure, null, 2));
  console.error(error);
  process.exitCode = 1;
}
