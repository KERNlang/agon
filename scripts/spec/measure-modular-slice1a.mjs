import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import {
  createLegacyCompatibilityRegistry,
  normalizeCandidates,
  resolveCandidates,
} from '../../packages/mod-kernel/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const cli = join(root, 'packages/cli/dist/index.js');
const isolated = mkdtempSync(join(tmpdir(), 'agon-modular-slice1a-'));
const env = {
  ...process.env,
  AGON_HOME: join(isolated, 'agon-home'),
  HOME: join(isolated, 'user-home'),
  XDG_CONFIG_HOME: join(isolated, 'user-home', '.config'),
  npm_config_cache: join(isolated, 'npm-cache'),
  npm_config_update_notifier: 'false',
  npm_config_ignore_scripts: 'true',
  NO_COLOR: '1',
};
for (const path of [env.AGON_HOME, env.HOME, env.XDG_CONFIG_HOME, env.npm_config_cache]) mkdirSync(path, { recursive: true });

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)];
}

async function sampleCold(args, runs = 15) {
  const durationMs = [];
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore'] });
    const code = await new Promise((done) => child.once('close', done));
    if (code !== 0) throw new Error(`cold command failed: ${args.join(' ')}`);
    durationMs.push(performance.now() - start);
  }
  return {
    args,
    runs,
    latencyMs: { p50: percentile(durationMs, 0.5), p95: percentile(durationMs, 0.95), max: Math.max(...durationMs) },
  };
}

function samplePeakRssMb(args, runs = 5) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    const measured = spawnSync(process.execPath, ['--import', join(root, 'scripts/spec/process-rss-probe.mjs'), cli, ...args], { cwd: root, env, encoding: 'utf8' });
    if (measured.status !== 0) throw new Error("RSS command failed: " + args.join(" ") + ": " + measured.stderr);
    const match = measured.stderr.match(/\[agon-slice1a-rss-kb\](\d+)/);
    if (!match) throw new Error('unable to parse process maximum resident set size');
    samples.push(Number(match[1]) / 1024);
  }
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: Math.max(...samples) };
}

function makeManifest(index) {
  const suffix = String(index).padStart(4, '0');
  const id = `bench.mod-${suffix}`;
  return {
    schemaVersion: 2,
    id,
    name: id,
    version: '1.0.0',
    apiRange: '^1.0.0',
    execution: 'executable',
    compatibility: { kernelRange: '^1.0.0', nodeRange: '>=22 <27' },
    packageClass: 'user-toggleable-mod-package',
    entrypoints: { runtime: 'dist/index.js', types: 'dist/index.d.ts' },
    display: { group: 'bench', order: index },
    dependencies: {
      required: index === 0 ? [] : [{ id: `bench.mod-${String(index - 1).padStart(4, '0')}`, range: '^1.0.0' }],
      optional: [], conflicts: [],
    },
    permissions: [],
    platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'],
    assets: [],
    contributes: { cliCommands: [], tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [] },
    pack: { include: ['dist/index.js', 'dist/index.d.ts', 'agon.mod.json'], executable: [] },
  };
}

function pack(workspace) {
  const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--dry-run', '-w', workspace], { cwd: root, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const report = JSON.parse(result.stdout)[0];
  return { workspace, packedBytes: report.size, unpackedBytes: report.unpackedSize, files: report.files.length };
}

try {
  const coldStart = [await sampleCold(['--version']), await sampleCold(['--help'])];
  for (const sample of coldStart) sample.peakRssMb = samplePeakRssMb(sample.args);
  const candidates = Array.from({ length: 1000 }, (_, index) => ({
    manifest: makeManifest(index), source: 'bundled', sourceLocator: `fixture:${index}`,
  }));
  const normalizedCandidates = normalizeCandidates(candidates);
  const desired = candidates.map(({ manifest }) => manifest.id);
  const resolverLatencies = [];
  let maxHeapDeltaBytes = 0;
  for (let run = 0; run < 15; run += 1) {
    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    const graph = resolveCandidates(normalizedCandidates, desired, { platform: `${process.platform}-${process.arch}`, kernelVersion: '1.0.0', apiVersion: '1.0.0', nodeVersion: process.version.slice(1) });
    resolverLatencies.push(performance.now() - start);
    globalThis.gc?.();
    maxHeapDeltaBytes = Math.max(maxHeapDeltaBytes, Math.max(0, process.memoryUsage().heapUsed - heapBefore));
    if (graph.order.length !== 1000) throw new Error('production resolver returned an incomplete graph');
  }
  const projectionLatencies = [];
  for (let run = 0; run < 100; run += 1) {
    const start = performance.now();
    const projections = createLegacyCompatibilityRegistry().projections();
    projectionLatencies.push(performance.now() - start);
    if (Object.values(projections).reduce((count, projection) => count + projection.entries.length, 0) !== 441) throw new Error('projection lost legacy entries');
  }
  const packageReports = [pack('packages/cli'), pack('packages/mod-api'), pack('packages/mod-kernel')];
  const packageAggregate = packageReports.reduce((total, report) => ({
    packedBytes: total.packedBytes + report.packedBytes,
    unpackedBytes: total.unpackedBytes + report.unpackedBytes,
    files: total.files + report.files,
  }), { packedBytes: 0, unpackedBytes: 0, files: 0 });
  const tui = spawnSync(process.execPath, ['scripts/perf/repl-typing-probe.mjs', '--keys', '30', '--blocks', '300', '--delay', '45'], { cwd: root, env, encoding: 'utf8' });
  const tuiOutput = `${tui.stdout}\n${tui.stderr}`;
  const match = tuiOutput.match(/p50\s+([\d.]+)\s+p95\s+([\d.]+)\s+max\s+([\d.]+)/);
  if (!match) throw new Error('unable to parse TUI typing probe output');
  const tuiP95 = Number(match[2]);
  if (!Number.isFinite(tuiP95)) throw new Error('TUI typing probe returned a non-finite p95');
  const budgetLimits = {
    coldStartP95Ms: process.platform === 'linux' ? 200 : 185,
    peakRssP95Mb: process.platform === 'linux' ? 128 : 124,
    resolverP95Ms: 100,
    resolverHeapBytes: 16 * 1024 * 1024,
    packedBytes: 1_980_000,
    unpackedBytes: 9_280_000,
    files: 250,
    tuiP95Ms: 12,
  };
  const evidence = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    isolation: { agonHome: 'temporary', home: 'temporary', npmCache: 'temporary' },
    coldStart,
    resolver: { candidates: 1000, runs: 15, p50Ms: percentile(resolverLatencies, 0.5), p95Ms: percentile(resolverLatencies, 0.95), maxMs: Math.max(...resolverLatencies), maxHeapDeltaBytes },
    projections: { entries: 441, runs: 100, p50Ms: percentile(projectionLatencies, 0.5), p95Ms: percentile(projectionLatencies, 0.95), maxMs: Math.max(...projectionLatencies) },
    packages: { reports: packageReports, aggregate: packageAggregate },
    tui: { exitCode: tui.status, p95Ms: tuiP95 },
    budgetLimits,
    budgets: {
      coldStartGreen: coldStart.every(({ latencyMs, peakRssMb }) => latencyMs.p95 <= budgetLimits.coldStartP95Ms && peakRssMb.p95 <= budgetLimits.peakRssP95Mb),
      resolverGreen: percentile(resolverLatencies, 0.95) <= budgetLimits.resolverP95Ms && maxHeapDeltaBytes <= budgetLimits.resolverHeapBytes,
      packageGreen: packageAggregate.packedBytes <= budgetLimits.packedBytes && packageAggregate.unpackedBytes <= budgetLimits.unpackedBytes && packageAggregate.files <= budgetLimits.files,
      tuiGreen: tui.status === 0 && tuiP95 <= budgetLimits.tuiP95Ms,
    },
  };
  writeFileSync(join(root, 'docs/specs/evidence/modular-agon-slice1a-performance.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  if (Object.values(evidence.budgets).some((green) => !green)) process.exitCode = 1;
} finally {
  rmSync(isolated, { recursive: true, force: true });
}
