import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolveCandidates } from '../../docs/specs/fixtures/modular-agon-contracts/contracts.mjs';

const root = resolve(import.meta.dirname, '../..');
const cli = join(root, 'packages/cli/dist/index.js');
const evidenceDir = join(root, 'docs/specs/evidence');
mkdirSync(evidenceDir, { recursive: true });
const isolated = mkdtempSync(join(tmpdir(), 'agon-modular-baseline-'));
const agonHome = join(isolated, 'agon-home');
const userHome = join(isolated, 'user-home');
const npmCache = join(isolated, 'npm-cache');
mkdirSync(agonHome, { recursive: true }); mkdirSync(userHome, { recursive: true }); mkdirSync(npmCache, { recursive: true });
const env = { ...process.env, AGON_HOME: agonHome, HOME: userHome, XDG_CONFIG_HOME: join(userHome, '.config'), npm_config_cache: npmCache, npm_config_update_notifier: 'false', NO_COLOR: '1' };

function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

async function sample(args, runs = 15) {
  const durations = []; const rssKb = []; let outputBytes = 0;
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; child.stdout.on('data', (chunk) => chunks.push(chunk)); child.stderr.on('data', (chunk) => chunks.push(chunk));
    let peak = 0;
    const poll = setInterval(() => {
      const ps = spawnSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' });
      const value = Number(String(ps.stdout ?? '').trim()); if (Number.isFinite(value) && value > 0) peak = Math.max(peak, value);
    }, 10);
    const code = await new Promise((resolvePromise) => child.once('close', resolvePromise));
    clearInterval(poll);
    if (code !== 0) throw new Error(`${args.join(' ')} exited ${code}: ${Buffer.concat(chunks).toString('utf8')}`);
    durations.push(performance.now() - start); rssKb.push(peak); outputBytes = Math.max(outputBytes, Buffer.concat(chunks).length);
  }
  return { command: ['node', 'packages/cli/dist/index.js', ...args], runs, latencyMs: { min: Math.min(...durations), p50: percentile(durations, .5), p95: percentile(durations, .95), max: Math.max(...durations) }, peakRssKb: { p50: percentile(rssKb, .5), p95: percentile(rssKb, .95), max: Math.max(...rssKb) }, maxOutputBytes: outputBytes };
}

try {
  const commands = [];
  for (const args of [['--version'], ['--help'], ['forge', '--help'], ['doctor', '--help'], ['models', '--help']]) commands.push(await sample(args));
  const packed = spawnSync('npm', ['pack', '-w', 'packages/cli', '--dry-run', '--json'], { cwd: root, env, encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout);
  const pack = JSON.parse(packed.stdout)[0];
  const packageMetrics = {
    filename: pack.filename, packageSizeBytes: pack.size, unpackedSizeBytes: pack.unpackedSize, fileCount: pack.entryCount ?? pack.files.length,
    pythonFiles: pack.files.filter((entry) => entry.path.endsWith('.py')).map((entry) => entry.path),
    forbiddenArtifacts: pack.files.filter((entry) => /(?:__pycache__|\.pyc$|\.tsbuildinfo$)/.test(entry.path)).map((entry) => entry.path),
  };
  const contractFixtures = JSON.parse(readFileSync(join(root, 'docs/specs/fixtures/modular-agon-valid-artifacts.json'), 'utf8'));
  const graphCandidates = Array.from({ length: 1000 }, (_, index) => {
    const suffix = String(index).padStart(4, '0');
    const id = `bench.mod-${suffix}`;
    return { source: 'bundled', sourceLocator: `fixture:${id}`, contentHash: `sha256:${(index % 16).toString(16).repeat(64)}`, manifest: { ...contractFixtures.manifest, id, name: id, dependencies: { required: index === 0 ? [] : [{ id: `bench.mod-${String(index - 1).padStart(4, '0')}`, range: '^1.0.0' }], optional: [], conflicts: [] } } };
  });
  const graphDesired = graphCandidates.map((candidate) => candidate.manifest.id);
  const graphLatencies = []; let graphHeapDeltaBytes = 0;
  for (let run = 0; run < 15; run += 1) {
    const beforeHeap = process.memoryUsage().heapUsed; const start = performance.now();
    const graph = resolveCandidates(graphCandidates, graphDesired);
    graphLatencies.push(performance.now() - start); graphHeapDeltaBytes = Math.max(graphHeapDeltaBytes, process.memoryUsage().heapUsed - beforeHeap);
    if (graph.order.length !== 1000) throw new Error('1000-mod graph resolver returned incomplete order');
  }
  const resolverGraph = { candidates: 1000, runs: 15, latencyMs: { p50: percentile(graphLatencies, .5), p95: percentile(graphLatencies, .95), max: Math.max(...graphLatencies) }, maxObservedHeapDeltaBytes: graphHeapDeltaBytes };
  const workflowTests = ['tests/integration/workflow-pipeline-call.test.ts', 'tests/integration/workflow-pipeline-slash.test.ts', 'tests/integration/forge-e2e.test.ts', 'tests/unit/thinking.test.ts', 'tests/unit/tribunal-modes.test.ts', 'tests/unit/brainstorm-dedup.test.ts', 'tests/unit/review-roles.test.ts', 'tests/unit/rag-core.test.ts', 'tests/unit/rooms.test.ts', 'tests/unit/daemon-workflow-job.test.ts'];
  const workflowStart = performance.now();
  const test = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...workflowTests], { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const workflowOutput = `${test.stdout}\n${test.stderr}`;
  const workflow = { command: ['vitest', 'run', ...workflowTests], durationMs: performance.now() - workflowStart, exitCode: test.status, passed: test.status === 0, summary: workflowOutput.split('\n').filter((line) => /Test Files|Tests\s+\d/.test(line)).map((line) => line.trim()), outputTail: workflowOutput.trim().split('\n').slice(-20) };
  const probe = spawnSync(process.execPath, ['scripts/perf/repl-typing-probe.mjs', '--keys', '30', '--blocks', '300', '--delay', '45'], { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const probeOutput = `${probe.stdout}\n${probe.stderr}`;
  const latencyMatch = probeOutput.match(/p50\s+([\d.]+)\s+p95\s+([\d.]+)\s+max\s+([\d.]+)/);
  const renders = Object.fromEntries([...probeOutput.matchAll(/^\s{2}(\w+)\s+([\d.]+)\s+\(/gm)].map((match) => [match[1], Number(match[2])]));
  const tuiTyping = { command: ['node', 'scripts/perf/repl-typing-probe.mjs', '--keys', '30', '--blocks', '300', '--delay', '45'], exitCode: probe.status, passed: probe.status === 0 && Boolean(latencyMatch), seededBlocks: 300, measuredKeystrokes: 30, latencyMs: latencyMatch ? { p50: Number(latencyMatch[1]), p95: Number(latencyMatch[2]), max: Number(latencyMatch[3]) } : null, rendersPerKeystroke: renders, outputTail: probeOutput.trim().split('\n').slice(-20) };
  const evidence = { schemaVersion: 1, measuredAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, node: process.version, candidate: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), isolation: { agonHome: 'temporary', userHome: 'temporary', npmCache: 'temporary' }, commands, package: packageMetrics, resolverGraph, representativeWorkflowSuite: workflow, tuiTyping };
  writeFileSync(join(evidenceDir, 'modular-agon-performance-baseline.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  if (!workflow.passed || !tuiTyping.passed || packageMetrics.forbiddenArtifacts.length || commands.some((entry) => entry.peakRssKb.max <= 0)) process.exitCode = 1;
} finally {
  rmSync(isolated, { recursive: true, force: true });
}
