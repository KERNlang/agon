import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const home = mkdtempSync(join(tmpdir(), 'agon-s5-perf-home-'));
const names = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(join(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8')))
  .packages.filter((entry) => entry.class === 'user-toggleable-mod-package').map((entry) => entry.id);
const percentile = (values, pct) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * pct) - 1)];
const directoryBytes = (directory) => readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
  const path = join(directory, entry.name);
  return sum + (entry.isDirectory() ? directoryBytes(path) : statSync(path).size);
}, 0);

try {
  const samples = [];
  const script = `const start=performance.now();for(const name of ${JSON.stringify(names)}){const loaded=await import(name);if(!loaded.MANIFEST||!Object.isFrozen(loaded.MANIFEST))process.exit(7)}if(global.gc)global.gc();console.log(JSON.stringify({durationMs:performance.now()-start,rssBytes:process.memoryUsage().rss}))`;
  for (let index = 0; index < 25; index += 1) {
    const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '--eval', script], { cwd: root, encoding: 'utf8', env: { ...process.env, AGON_HOME: home } });
    if (result.status !== 0) throw new Error(`first-party import probe failed: ${result.stderr}`);
    samples.push(JSON.parse(result.stdout.trim()));
  }
  const metrics = {
    schemaVersion: 1, slice: 'S5', sampleCount: samples.length,
    coldImportMs: { median: percentile(samples.map((sample) => sample.durationMs), 0.5), p95: percentile(samples.map((sample) => sample.durationMs), 0.95), max: Math.max(...samples.map((sample) => sample.durationMs)), budgetP95: 750 },
    residentRssBytes: { median: percentile(samples.map((sample) => sample.rssBytes), 0.5), p95: percentile(samples.map((sample) => sample.rssBytes), 0.95), budgetP95: 128 * 1024 * 1024 },
    totalWorkspaceBytes: names.reduce((sum, name) => sum + directoryBytes(join(root, 'packages', name.replace('@kernlang/agon-', ''))), 0),
  };
  metrics.passed = metrics.coldImportMs.p95 <= metrics.coldImportMs.budgetP95 && metrics.residentRssBytes.p95 <= metrics.residentRssBytes.budgetP95;
  writeFileSync(join(root, 'docs/specs/evidence/modular-agon-slice5-performance.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(JSON.stringify(metrics, null, 2));
  if (!metrics.passed) process.exit(1);
} finally {
  rmSync(home, { recursive: true, force: true });
}
