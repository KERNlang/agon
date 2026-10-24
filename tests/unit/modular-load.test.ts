import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { failureFixtureObserved, loadEnvironment, loadEvidencePasses, LOAD_LIMITS } from '../../scripts/spec/measure-modular-load.mjs';
import { loadEvidenceFixture } from '../fixtures/modular-load-evidence.js';

it('accepts complete load evidence, not an empty or historical verdict', () => {
  expect(loadEvidencePasses(loadEvidenceFixture())).toBe(true);
  for (const value of [null, undefined, {}, { passed: true }, { measurement: 'modular-agon-load', passed: true }]) {
    expect(loadEvidencePasses(value)).toBe(false);
  }
});

it.each([
  ['passed', false], ['shutdown', false], ['durationMs', 119999], ['durationMs', Infinity],
  ['shutdownMs', 8000], ['shutdownMs', -1], ['shutdownMs', NaN],
  ['completedJobs', 255], ['completedJobs', NaN], ['verifiedOutputs', 255],
  ['requestP95Ms', LOAD_LIMITS.requestP95Ms + 1], ['requestP95Ms', -1], ['requestP95Ms', '1'],
  ['peakDaemonRssBytes', LOAD_LIMITS.daemonRssBytes + 1], ['peakDaemonRssBytes', 0],
  ['peakTreeRssBytes', LOAD_LIMITS.treeRssBytes + 1], ['peakTreeRssBytes', 1],
  ['settledRssGrowthBytes', LOAD_LIMITS.rssGrowthBytes + 1], ['settledRssGrowthBytes', NaN],
  ['rssSampleCount', 99], ['maxRetainedJobs', 101], ['maxRetainedJobs', 0],
] as const)('rejects a red or missing %s measurement (%s) in either phase', (key, value) => {
  for (const index of [0, 1]) {
    const evidence = loadEvidenceFixture();
    Object.assign(evidence.phases[index], { [key]: value });
    expect(loadEvidencePasses(evidence)).toBe(false);
    Reflect.deleteProperty(evidence.phases[index], key);
    expect(loadEvidencePasses(evidence)).toBe(false);
  }
});

it.each(['failedJob', 'cancelledJob', 'cancelledEngineGone', 'recovery', 'shutdownEngineGone', 'hostFilesRemoved'])(
  'requires the %s recovery control', key => {
    const evidence = loadEvidenceFixture();
    Object.assign(evidence.phases[1].controls, { [key]: false });
    expect(loadEvidencePasses(evidence)).toBe(false);
  },
);

it.each(['fixtureStarts', 'fixtureEnds', 'peakFixtureConcurrency', 'pendingFixtures'])(
  'rejects incomplete execution evidence: %s', key => {
    const evidence = loadEvidenceFixture();
    Object.assign(evidence.phases[1], { [key]: -1 });
    expect(loadEvidencePasses(evidence)).toBe(false);
  },
);

it('rejects changed phase order, absent phases and mismatched runtime identity', () => {
  const evidence = loadEvidenceFixture();
  expect(loadEvidencePasses({ ...evidence, passed: 'true' })).toBe(false);
  expect(loadEvidencePasses({ ...evidence, phases: [...evidence.phases].reverse() })).toBe(false);
  expect(loadEvidencePasses({ ...evidence, phases: evidence.phases.slice(1) })).toBe(false);
  expect(loadEvidencePasses({ ...evidence, platform: 'other' })).toBe(false);
  expect(loadEvidencePasses({ ...evidence, node: 'v0.0.0' })).toBe(false);
});

it.each([false, true])('local engine fixture supplies a discriminating process result (failed=%s)', failed => {
  const home = mkdtempSync(join(tmpdir(), 'agon-load-fixture-'));
  try {
    const result = spawnSync(process.execPath, [resolve('scripts/spec/fixtures/modular-load-engine.mjs'), home,
      failed ? 'AGON_LOAD_FAIL' : 'local success'], { env: { ...process.env, AGON_HOME: home }, encoding: 'utf8', timeout: 2000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(failed ? 7 : 0);
    if (!failed) expect(JSON.parse(result.stdout).summary).toBe('AGON_LOCAL_LOAD_OK');
    const events = readFileSync(join(home, 'load-engines.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(event => event.phase)).toEqual(['start', 'end']);
    expect(events.every(event => event.pid > 0 && event.mode === (failed ? 'fail' : 'success'))).toBe(true);
    expect(failureFixtureObserved(events)).toBe(failed);
    expect(failureFixtureObserved([])).toBe(false);
    expect(failureFixtureObserved(events.slice(0, 1))).toBe(false);
    expect(failureFixtureObserved([events[0], { ...events[1], pid: events[1].pid + 1 }])).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('does not inherit startup hooks, provider paths or credentials into load children', () => {
  const home = mkdtempSync(join(tmpdir(), 'agon-load-env-'));
  try {
    const marker = join(home, 'preloaded');
    const hook = join(home, 'hook.cjs');
    writeFileSync(hook, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'loaded');`);
    const inherited = { ...process.env, NODE_OPTIONS: `--require=${hook}`, PATH: '/private-provider-bin', API_KEY: 'fixture-only' };
    const control = spawnSync(process.execPath, ['-e', ''], { env: inherited, timeout: 2000 });
    expect(control.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);
    const env = loadEnvironment(home, inherited, 'workflow');
    const isolated = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(process.env))'], { env, encoding: 'utf8', timeout: 2000 });
    expect(isolated.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
    const observed = JSON.parse(isolated.stdout);
    expect(observed.HOME).toBe(home);
    expect(observed.PATH).toBe('/usr/bin:/bin');
    expect(observed.API_KEY).toBeUndefined();
    expect(observed.AGON_DAEMON_ECHO).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
