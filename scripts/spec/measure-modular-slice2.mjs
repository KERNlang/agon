import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { DurableModHost } from '../../packages/mod-kernel/dist/index.js';

const repository = resolve(import.meta.dirname, '../..');
const isolated = mkdtempSync(join(tmpdir(), 'agon-modular-slice2-'));
const store = join(isolated, 'host');
const probe = join(repository, 'scripts/spec/process-modular-host-probe.mjs');

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)];
}

function hash(character) { return `sha256:${character.repeat(64)}`; }

const packages = Array.from({ length: 49 }, (_, index) => ({
  id: `agon.fixture-${String(index).padStart(2, '0')}`,
  version: '1.0.0',
  source: 'bundled',
  sourceLocator: `bundled:${index}`,
  contentHash: hash('a'),
  manifestHash: hash('b'),
  platform: `${process.platform}-${process.arch}`,
  enabled: true,
  resolutionOrder: index,
  dependencies: index === 0 ? [] : [`agon.fixture-${String(index - 1).padStart(2, '0')}`],
  trustRecordId: `first-party-${index}`,
  grantRecordIds: [],
}));
const lock = {
  schemaVersion: 1,
  kernelVersion: '1.0.0',
  apiVersion: '1.0.0',
  desiredStateHash: hash('d'),
  graphHash: hash('e'),
  packages,
};

async function coldSamples(runs) {
  const values = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    const child = spawn(process.execPath, [probe, store], { cwd: repository, stdio: 'ignore' });
    const status = await new Promise((done) => child.once('close', done));
    if (status !== 0) throw new Error('modular host cold probe failed');
    values.push(performance.now() - started);
  }
  return values;
}

try {
  const host = new DurableModHost(store, { kernelVersion: '1.0.0', processIdentity: 'measurement-setup' });
  const commitStarted = performance.now();
  await host.commitGeneration({
    operation: 'install', lock, desiredState: { enabled: packages.map(({ id }) => id) }, installedIndex: { packages },
    files: Object.fromEntries(packages.map(({ id }) => [`packages/${id}/agon.mod.json`, JSON.stringify({ id, version: '1.0.0' })])),
  });
  const commitMs = performance.now() - commitStarted;
  const cold = await coldSamples(15);
  const rss = [];
  for (let index = 0; index < 5; index += 1) {
    const measured = spawnSync(process.execPath, ['--import', join(repository, 'scripts/spec/process-rss-probe.mjs'), probe, store], { cwd: repository, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(isolated, 'npm-cache'), npm_config_ignore_scripts: 'true' } });
    if (measured.status !== 0) throw new Error('modular host RSS probe failed');
    const match = measured.stderr.match(/\[agon-slice1a-rss-kb\](\d+)/);
    if (!match) throw new Error('unable to parse modular host RSS');
    rss.push(Number(match[1]) / 1024);
  }
  const warm = [];
  for (let index = 0; index < 100; index += 1) {
    const started = performance.now();
    const boot = await host.boot();
    if (boot.mode !== 'normal') throw new Error('warm boot entered recovery');
    warm.push(performance.now() - started);
  }
  const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--dry-run', '-w', 'packages/mod-kernel'], { cwd: repository, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(isolated, 'npm-cache'), npm_config_ignore_scripts: 'true' } });
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout);
  const packageReport = JSON.parse(packed.stdout)[0];
  const limits = { coldP95Ms: process.platform === 'linux' ? 175 : 160, peakRssP95Mb: process.platform === 'linux' ? 128 : 124 };
  const evidence = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    fixture: { packages: packages.length, generationFiles: packages.length + 4 },
    transaction: { firstCommitMs: commitMs, informational: true },
    coldBoot: { runs: cold.length, p50Ms: percentile(cold, 0.5), p95Ms: percentile(cold, 0.95), maxMs: Math.max(...cold) },
    warmBoot: { runs: warm.length, p50Ms: percentile(warm, 0.5), p95Ms: percentile(warm, 0.95), maxMs: Math.max(...warm) },
    peakRssMb: { runs: rss.length, p50: percentile(rss, 0.5), p95: percentile(rss, 0.95), max: Math.max(...rss) },
    package: { packedBytes: packageReport.size, unpackedBytes: packageReport.unpackedSize, files: packageReport.files.length },
    limits,
    budgets: { coldGreen: percentile(cold, 0.95) <= limits.coldP95Ms, rssGreen: percentile(rss, 0.95) <= limits.peakRssP95Mb },
  };
  writeFileSync(join(repository, 'docs/specs/evidence/modular-agon-slice2-performance.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  if (Object.values(evidence.budgets).some((green) => !green)) process.exitCode = 1;
} finally {
  spawnSync('chmod', ['-R', 'u+w', isolated]);
  rmSync(isolated, { recursive: true, force: true });
}
