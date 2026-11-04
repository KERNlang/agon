import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LOAD_LIMITS = Object.freeze({ durationMs: 120000, minimumJobs: 256,
  requestP95Ms: 50, daemonRssBytes: 192 * 1024 * 1024,
  treeRssBytes: 9 * 192 * 1024 * 1024, rssGrowthBytes: 32 * 1024 * 1024 });
const root = resolve(import.meta.dirname, '../..');
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function loadEnvironment(home, previous, id) {
  const env = { PATH: '/usr/bin:/bin', NODE_OPTIONS: '--max-old-space-size=4096',
    CI: 'true', npm_config_ignore_scripts: 'true', npm_config_offline: 'true',
    AGON_MODULAR_HOST_ROOT: join(home, 'modular-host') };
  for (const key of ['LANG', 'TZ']) if (previous[key]) env[key] = previous[key];
  for (const key of ['HOME', 'AGON_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'npm_config_cache']) env[key] = home;
  if (id === 'transport') env.AGON_DAEMON_ECHO = '1';
  return env;
}

export function failureFixtureObserved(events) {
  return events.length === 2 && events[0].phase === 'start' && events[1].phase === 'end'
    && events.every(event => event.mode === 'fail' && Number.isSafeInteger(event.pid) && event.pid > 0)
    && events[0].pid === events[1].pid;
}

export function loadEvidencePasses(evidence) {
  if (evidence?.schemaVersion !== 1 || evidence.measurement !== 'modular-agon-load'
    || evidence.passed !== true || !Array.isArray(evidence.phases) || evidence.phases.length !== 2
    || evidence.platform !== `${process.platform}-${process.arch}` || evidence.node !== process.version) return false;
  if (!['transport', 'workflow'].every((id, index) => {
    const phase = evidence.phases[index];
    return phase?.id === id && phase.passed === true && phase.shutdown === true
      && finite(phase.shutdownMs) && phase.shutdownMs >= 0 && phase.shutdownMs <= 3500
      && finite(phase.durationMs) && phase.durationMs >= LOAD_LIMITS.durationMs
      && Number.isSafeInteger(phase.completedJobs) && phase.completedJobs >= LOAD_LIMITS.minimumJobs
      && finite(phase.requestP95Ms) && phase.requestP95Ms >= 0 && phase.requestP95Ms <= LOAD_LIMITS.requestP95Ms
      && finite(phase.peakDaemonRssBytes) && phase.peakDaemonRssBytes > 0 && phase.peakDaemonRssBytes <= LOAD_LIMITS.daemonRssBytes
      && finite(phase.peakTreeRssBytes) && phase.peakTreeRssBytes >= phase.peakDaemonRssBytes && phase.peakTreeRssBytes <= LOAD_LIMITS.treeRssBytes
      && finite(phase.settledRssGrowthBytes) && phase.settledRssGrowthBytes <= LOAD_LIMITS.rssGrowthBytes
      && Number.isSafeInteger(phase.rssSampleCount) && phase.rssSampleCount >= 100
      && phase.maxRetainedJobs === 100 && phase.verifiedOutputs === phase.completedJobs;
  })) return false;
  const workflow = evidence.phases[1];
  return workflow.fixtureStarts === workflow.completedJobs && workflow.fixtureEnds === workflow.completedJobs
    && workflow.peakFixtureConcurrency === 4 && workflow.pendingFixtures === 0
    && ['failedJob', 'cancelledJob', 'cancelledEngineGone', 'recovery', 'shutdownEngineGone', 'hostFilesRemoved']
      .every(key => workflow.controls?.[key] === true);
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
}

async function until(check, timeoutMs, description) {
  const deadline = performance.now() + timeoutMs;
  while (!check()) {
    assert.ok(performance.now() < deadline, description);
    await delay(25);
  }
}

async function measurePhase(id, clientModule, dist) {
  // A short path keeps Unix sockets valid on both supported operating systems.
  const home = mkdtempSync('/tmp/agon-load-');
  const previous = { ...process.env };
  const phase = { id, passed: false, samples: [] };
  let daemonPid;
  let child;
  let monitor;
  let monitorError;
  let sendDaemonRequest;
  const cancellation = new AbortController();
  const engineLog = join(home, 'load-engines.jsonl');
  const engineEvents = () => existsSync(engineLog)
    ? readFileSync(engineLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const latencies = [];
  async function request(message, expected) {
    const started = performance.now();
    const reply = await sendDaemonRequest(message, 3000);
    latencies.push(performance.now() - started);
    assert.equal(reply?.type, expected, JSON.stringify({ message, reply }));
    if (monitorError) throw monitorError;
    return reply;
  }
  const submit = input => request({ type: 'job-submit', kind: id === 'workflow' ? 'think' : 'brainstorm',
    payload: { input, cwd: home, ...(id === 'workflow' ? { engine: 'load-fixture', steps: '1' } : {}) } }, 'job-accepted');
  async function result(jobId) {
    const deadline = performance.now() + 15000;
    for (;;) {
      const reply = await request({ type: 'job-result', jobId }, 'job-result');
      if (reply.ready) return reply.outcome;
      assert.ok(performance.now() < deadline, 'job result deadline');
      await delay(25);
    }
  }
  async function succeed(input) {
    const { job } = await submit(input);
    assert.equal((await result(job.id)).state, 'succeeded');
    const events = await request({ type: 'job-events', jobId: job.id }, 'job-events');
    assert.ok(events.events.filter(event => event.type === 'stdout').map(event => event.data.text).join('').includes('AGON_LOCAL_LOAD_OK'));
  }
  try {
    const env = loadEnvironment(home, previous, id);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    ({ sendDaemonRequest } = await import(pathToFileURL(join(dist, clientModule))));
    const { spawnWithTimeout } = await import('@kernlang/agon-support-engine-runtime');
    mkdirSync(join(home, 'engines'));
    writeFileSync(join(home, 'engines/load-fixture.json'), JSON.stringify({ schemaVersion: 3, id: 'load-fixture',
      displayName: 'Local load fixture', binary: process.execPath, isLocal: true, tier: 'user', timeout: 10,
      exec: { args: [join(root, 'scripts/spec/fixtures/modular-load-engine.mjs'), home, '{prompt}'] } }));
    child = spawnWithTimeout({ command: process.execPath, args: [join(dist, 'index.js'), 'daemon', 'run', '--foreground'],
      cwd: home, env, signal: cancellation.signal, timeout: LOAD_LIMITS.durationMs + 60000,
      maxOutputBytes: 1024 * 1024, onSpawn: pid => { daemonPid = pid; } });
    await until(() => existsSync(join(home, 'daemon/agond.sock')), 10000, 'daemon startup deadline');
    const identity = await request({ type: 'ping' }, 'pong');
    const started = performance.now();
    const sample = () => {
      const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8', timeout: 3000, maxBuffer: 4 * 1024 * 1024 })
        .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
      const owner = rows.find(([pid]) => pid === daemonPid);
      assert.ok(owner && finite(owner[2]) && owner[2] > 0, 'daemon RSS available');
      const descendants = new Set([daemonPid]);
      for (let size = 0; size !== descendants.size;) {
        size = descendants.size;
        for (const [pid, parent] of rows) if (descendants.has(parent)) descendants.add(pid);
      }
      const treeRssBytes = rows.filter(([pid]) => descendants.has(pid)).reduce((sum, row) => sum + row[2] * 1024, 0);
      phase.samples.push({ elapsedMs: performance.now() - started, daemonRssBytes: owner[2] * 1024, treeRssBytes, processes: descendants.size });
    };
    sample();
    monitor = setInterval(() => { try { sample(); } catch (error) { monitorError ??= error; } }, 250);
    let completed = 0;
    let maxRetained = 0;
    while (performance.now() - started < LOAD_LIMITS.durationMs) {
      const batch = await Promise.all(Array.from({ length: 8 }, (_, n) => submit(`load-${completed + n}`)));
      for (const { job } of batch) {
        const outcome = await result(job.id);
        assert.equal(outcome.state, 'succeeded', JSON.stringify(outcome));
        const events = await request({ type: 'job-events', jobId: job.id }, 'job-events');
        assert.ok(events.events.some(event => event.type === 'succeeded'));
        const output = events.events.filter(event => event.type === 'stdout').map(event => event.data.text).join('');
        assert.ok(output.includes(id === 'workflow' ? 'AGON_LOCAL_LOAD_OK' : `echo job: ${job.label}`));
      }
      completed += batch.length;
      const listed = await request({ type: 'job-list' }, 'job-list');
      assert.ok(listed.jobs.length <= 100, 'terminal retention bound');
      maxRetained = Math.max(maxRetained, listed.jobs.length);
      assert.equal((await request({ type: 'ping' }, 'pong')).sessionId, identity.sessionId);
      await delay(25);
    }
    clearInterval(monitor);
    sample();
    if (monitorError) throw monitorError;
    const durationMs = performance.now() - started;
    const medianWindow = (from, to) => percentile(phase.samples.filter(sample => sample.elapsedMs >= from && sample.elapsedMs <= to).map(sample => sample.daemonRssBytes), 0.5);
    Object.assign(phase, { durationMs, completedJobs: completed, verifiedOutputs: completed,
      requestP95Ms: percentile(latencies, 0.95), maxRetainedJobs: maxRetained, rssSampleCount: phase.samples.length,
      peakDaemonRssBytes: Math.max(...phase.samples.map(sample => sample.daemonRssBytes)),
      peakTreeRssBytes: Math.max(...phase.samples.map(sample => sample.treeRssBytes)),
      settledRssGrowthBytes: medianWindow(durationMs * 0.75, durationMs) - medianWindow(durationMs * 0.25, durationMs * 0.5) });
    if (id === 'workflow') {
      const events = engineEvents();
      const pending = new Set();
      let peak = 0;
      for (const event of events) {
        if (event.phase === 'start') { assert.ok(!pending.has(event.pid)); pending.add(event.pid); }
        else { assert.equal(event.phase, 'end'); assert.ok(pending.delete(event.pid)); }
        peak = Math.max(peak, pending.size);
      }
      Object.assign(phase, { fixtureStarts: events.filter(event => event.phase === 'start').length,
        fixtureEnds: events.filter(event => event.phase === 'end').length, peakFixtureConcurrency: peak, pendingFixtures: pending.size });
      phase.controls = {};
      const beforeFailure = engineEvents().length;
      const failed = await submit('AGON_LOAD_FAIL');
      assert.equal((await result(failed.job.id)).state, 'failed');
      assert.ok(failureFixtureObserved(engineEvents().slice(beforeFailure)), 'failed fixture actually executed');
      phase.controls.failedJob = true;
      await succeed('recovery-after-failure');
      const cancelled = await submit('AGON_LOAD_CANCEL');
      await until(() => engineEvents().some(event => event.mode === 'cancel'), 5000, 'cancel fixture start');
      const engine = engineEvents().find(event => event.mode === 'cancel');
      assert.equal((await request({ type: 'job-cancel', jobId: cancelled.job.id }, 'job-cancelled')).job.state, 'cancelled');
      phase.controls.cancelledJob = (await result(cancelled.job.id)).state === 'cancelled';
      await until(() => !isAlive(engine.pid), 3500, 'cancelled engine stopped');
      phase.controls.cancelledEngineGone = true;
      await succeed('recovery-after-cancellation');
      phase.controls.recovery = true;
      await submit('AGON_LOAD_SHUTDOWN');
      await until(() => engineEvents().some(event => event.mode === 'shutdown'), 5000, 'shutdown fixture start');
    }
    const shutdownStarted = performance.now();
    await request({ type: 'shutdown' }, 'bye');
    const stopped = await child;
    assert.equal(stopped.exitCode, 0, stopped.stderr);
    assert.equal(stopped.timedOut, false);
    phase.shutdown = true;
    if (id === 'workflow') {
      const engine = engineEvents().find(event => event.mode === 'shutdown');
      await until(() => !isAlive(engine.pid), Math.max(0, 3500 - (performance.now() - shutdownStarted)), 'shutdown engine stopped');
      phase.controls.shutdownEngineGone = true;
      phase.controls.hostFilesRemoved = !existsSync(join(home, 'daemon/agond.sock')) && !existsSync(join(home, 'daemon/agond.pid'));
    }
    phase.shutdownMs = performance.now() - shutdownStarted;
    assert.ok(phase.shutdownMs <= 3500, 'shutdown cancels work instead of draining the eight-second fixture');
    phase.passed = true;
  } catch (error) {
    phase.error = String(error?.stack ?? error);
  } finally {
    clearInterval(monitor);
    cancellation.abort();
    if (child) {
      const stopped = await child;
      phase.daemonStderr = stopped.stderr;
    }
    try {
      const pending = new Set();
      for (const event of engineEvents()) {
        assert.ok(Number.isSafeInteger(event.pid) && event.pid > 0, 'valid fixture PID');
        if (event.phase === 'start') pending.add(event.pid); else pending.delete(event.pid);
      }
      for (const pid of pending) if (isAlive(pid)) {
        phase.passed = false;
        phase.cleanupError = 'engine process survived daemon shutdown';
        const identity = execFileSync('ps', ['-o', 'pgid=,command=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000 }).trim();
        assert.ok(identity.startsWith(`${pid} `) && identity.includes('modular-load-engine.mjs') && identity.includes(home), 'owned fixture identity before cleanup');
        process.kill(-pid, 'SIGKILL');
      }
      const generations = join(home, 'modular-host/generations');
      if (existsSync(generations)) for (const entry of readdirSync(generations, { withFileTypes: true })) {
        if (entry.isDirectory()) chmodSync(join(generations, entry.name), 0o700);
      }
      rmSync(home, { recursive: true, force: true });
    } catch (error) {
      phase.passed = false;
      phase.cleanupError = String(error);
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  }
  return phase;
}

async function main() {
  const evidence = { schemaVersion: 1, measurement: 'modular-agon-load', passed: false,
    platform: `${process.platform}-${process.arch}`, node: process.version, limits: LOAD_LIMITS, phases: [] };
  try {
    assert.ok(['darwin', 'linux'].includes(process.platform), 'supported native platform required');
    const dist = join(root, 'packages/cli/dist');
    const modules = readdirSync(dist).filter(name => /^daemon-[\w-]+\.js$/.test(name));
    assert.equal(modules.length, 1, 'exactly one built daemon client module');
    for (const id of ['transport', 'workflow']) {
      const phase = await measurePhase(id, modules[0], dist);
      evidence.phases.push(phase);
      if (!phase.passed) break;
    }
    evidence.passed = loadEvidencePasses({ ...evidence, passed: true });
  } catch (error) { evidence.error = String(error?.stack ?? error); }
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
