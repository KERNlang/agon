import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DurableModHost,
  ManagedLifecycleService,
  createManagedLifecyclePlan,
} from '../../packages/mod-kernel/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const hash = (value) => `sha256:${value.repeat(64)}`;
const percentile = (values, pct) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * pct) - 1)];
const samples = [];
const makeRemovable = (path) => {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) makeRemovable(child);
    else chmodSync(child, 0o600);
  }
};

for (let index = 0; index < 15; index += 1) {
  const home = mkdtempSync(join(tmpdir(), 'agon-s7-perf-'));
  try {
    const artifact = Object.freeze({
      id: '@perf/app', version: '1.0.0', source: 'local-cache', sourceLocator: 'cache:@perf/app@1.0.0',
      integrity: 'sha512-YQ==', contentHash: hash('a'), manifestHash: hash('b'), dependencies: [], lifecycleScripts: [],
      available: true, provenance: 'verified', trustTier: 'first-party',
    });
    const lock = Object.freeze({
      schemaVersion: 1, kernelVersion: '1.0.0', apiVersion: '1.0.0', desiredStateHash: hash('c'), graphHash: hash('d'),
      packages: [Object.freeze({
        id: artifact.id, version: artifact.version, source: 'registry', sourceLocator: artifact.sourceLocator,
        contentHash: artifact.contentHash, manifestHash: artifact.manifestHash, platform: 'darwin-arm64', enabled: true,
        resolutionOrder: 0, dependencies: [], trustRecordId: 'trust:@perf/app', grantRecordIds: [],
      })],
    });
    const host = new DurableModHost(home, { kernelVersion: '1.0.0', processIdentity: `perf-host-${index}` });
    const service = new ManagedLifecycleService(host, { processIdentity: `perf-lifecycle-${index}` });
    const request = {
      operation: 'install', networkPolicy: 'frozen-offline', kernelVersion: '1.0.0', apiVersion: '1.0.0',
      requestedPackageIds: [artifact.id], artifacts: [artifact], desiredState: { enabled: [artifact.id] }, lock,
    };
    const planStarted = performance.now();
    const plan = await createManagedLifecyclePlan(host, request);
    const planFinished = performance.now();
    await service.apply(plan, {
      async install(entry, prefix) {
        const destination = join(prefix, 'node_modules', entry.id);
        await mkdir(destination, { recursive: true });
        await writeFile(join(destination, 'package.json'), JSON.stringify({ name: entry.id, version: entry.version }));
      },
    }, {
      async verify() { return { passed: true, checks: [{ id: 'smoke', passed: true }] }; },
    });
    const applied = performance.now();
    if (global.gc) global.gc();
    samples.push({ planMs: planFinished - planStarted, applyMs: applied - planFinished, totalMs: applied - planStarted, rssBytes: process.memoryUsage().rss });
  } finally {
    makeRemovable(home);
    rmSync(home, { recursive: true, force: true });
  }
}

const metrics = {
  schemaVersion: 1,
  slice: 'S7',
  sampleCount: samples.length,
  planMs: { median: percentile(samples.map((sample) => sample.planMs), 0.5), p95: percentile(samples.map((sample) => sample.planMs), 0.95), budgetP95: 25 },
  applyMs: { median: percentile(samples.map((sample) => sample.applyMs), 0.5), p95: percentile(samples.map((sample) => sample.applyMs), 0.95), budgetP95: 1000 },
  totalMs: { median: percentile(samples.map((sample) => sample.totalMs), 0.5), p95: percentile(samples.map((sample) => sample.totalMs), 0.95), budgetP95: 1025 },
  residentRssBytes: { median: percentile(samples.map((sample) => sample.rssBytes), 0.5), p95: percentile(samples.map((sample) => sample.rssBytes), 0.95), budgetP95: 192 * 1024 * 1024 },
};
metrics.passed = metrics.planMs.p95 <= metrics.planMs.budgetP95
  && metrics.applyMs.p95 <= metrics.applyMs.budgetP95
  && metrics.totalMs.p95 <= metrics.totalMs.budgetP95
  && metrics.residentRssBytes.p95 <= metrics.residentRssBytes.budgetP95;
writeFileSync(join(root, 'docs/specs/evidence/modular-agon-slice7-performance.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics, null, 2));
if (!metrics.passed) process.exitCode = 1;
