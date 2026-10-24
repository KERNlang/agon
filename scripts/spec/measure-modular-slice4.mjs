import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const home = mkdtempSync(join(tmpdir(), 'agon-s4-perf-home-'));
const names = [
  'engine-runtime', 'persistence', 'dedup', 'browser-bridge', 'saas-api',
  'engine-catalog', 'verification', 'panel', 'worktree', 'agent-runtime', 'judge',
];

function percentile(values, pct) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * pct) - 1)];
}

function directoryBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(directory, entry.name);
    return sum + (entry.isDirectory() ? directoryBytes(path) : statSync(path).size);
  }, 0);
}

try {
  const samples = [];
  const script = `
    const start = performance.now();
    const names = ${JSON.stringify(names)};
    for (const name of names) {
      const loaded = await import('@kernlang/agon-support-' + name);
      if (!loaded.SUPPORT_PACKAGE || !Object.isFrozen(loaded.SUPPORT_PACKAGE)) process.exit(7);
    }
    if (global.gc) global.gc();
    console.log(JSON.stringify({ durationMs: performance.now() - start, rssBytes: process.memoryUsage().rss }));
  `;
  for (let index = 0; index < 25; index += 1) {
    const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '--eval', script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AGON_HOME: home },
    });
    if (result.status !== 0) throw new Error(`support import probe failed: ${result.stderr}`);
    samples.push(JSON.parse(result.stdout.trim()));
  }
  const totalPackageBytes = names.reduce((sum, name) => sum + directoryBytes(join(root, 'packages', `support-${name}`)), 0);
  const metrics = {
    schemaVersion: 1,
    slice: 'S4',
    sampleCount: samples.length,
    coldImportMs: {
      median: percentile(samples.map((sample) => sample.durationMs), 0.5),
      p95: percentile(samples.map((sample) => sample.durationMs), 0.95),
      max: Math.max(...samples.map((sample) => sample.durationMs)),
      budgetP95: 500,
    },
    residentRssBytes: {
      median: percentile(samples.map((sample) => sample.rssBytes), 0.5),
      p95: percentile(samples.map((sample) => sample.rssBytes), 0.95),
      budgetP95: 96 * 1024 * 1024,
    },
    totalWorkspaceBytes: totalPackageBytes,
    passed: true,
  };
  metrics.passed = metrics.coldImportMs.p95 <= metrics.coldImportMs.budgetP95
    && metrics.residentRssBytes.p95 <= metrics.residentRssBytes.budgetP95;
  if (!process.argv.includes('--no-write')) writeFileSync(join(root, 'docs/specs/evidence/modular-agon-slice4-performance.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(JSON.stringify(metrics, null, 2));
  if (!metrics.passed) process.exit(1);
} finally {
  rmSync(home, { recursive: true, force: true });
}
