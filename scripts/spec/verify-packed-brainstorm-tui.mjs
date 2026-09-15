import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Real PTY and installed npm bin. The engine alone is a local protocol fixture. */
export function verifyPackedBrainstormTui(prefix, scratch, env) {
  const home = join(scratch, 'brainstorm-tui');
  const gate = join(home, 'gate');
  const log = join(home, 'engine-calls');
  const terminal = join(home, 'terminal.log');
  mkdirSync(join(home, 'engines'), { recursive: true });
  writeFileSync(gate, 'ready'); // TUI intentionally does not print the CLI run-path protocol.
  writeFileSync(join(home, 'engines/fixture-brainstorm.json'), JSON.stringify({
    schemaVersion: 3, id: 'fixture-brainstorm', displayName: 'Fixture Brainstorm',
    binary: process.execPath, searchPaths: [], versionCmd: ['--version'], isLocal: true,
    tier: 'user', installHint: 'Qualification fixture only', timeout: 60,
    exec: { args: [join(import.meta.dirname, 'fixtures/brainstorm-engine.mjs'), gate, log, 'human', '{prompt}'] },
  }));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    onboarded: true, engineActivationMode: 'explicit', forgeEnabledEngines: ['fixture-brainstorm'],
    cesarEngine: 'fixture-brainstorm', terminalMode: 'native', cesarAutoMode: false,
    cesarAutoModePrompted: true, isolationMigrationNotified: true, resumePausedPlanOnStartup: false,
  }));
  const steps = [{ sleep: 2500 }];
  for (const question of ['Installed fixture question FAIL_UI_FIXTURE', 'Installed fixture question', 'Installed fixture question again']) {
    steps.push({ send: `/brainstorm ${question}`, settle: 100 }, { sendHex: '0d' }, { sleep: 5000 });
    if (question.includes('FAIL_UI_FIXTURE')) {
      steps.push({ send: '/brainstorm Installed fixture question CANCEL_UI_FIXTURE', settle: 100 },
        { sendHex: '0d' }, { waitForFile: `${log}.started`, timeout: 5000 },
        { sendHex: '1b' }, { waitForFile: `${log}.stopped`, timeout: 3000 }, { sleep: 1000 });
    }
  }
  steps.push({ sendHex: '03', settle: 100 }, { sendHex: '03' }, { waitForExit: 5000 });
  const tuiEnv = { ...env, HOME: home, AGON_HOME: home, AGON_MODULAR_HOST_ROOT: join(home, 'modular-host'),
    XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'),
    AGON_NO_UPDATE_CHECK: '1', TERM: 'xterm-256color', PTY_LOG: terminal };
  // Some terminal dependencies detect CI by key presence, not its value.
  // This is deliberately an interactive PTY even when its parent is CI.
  delete tuiEnv.CI;
  const result = spawnSync('python3', [join(import.meta.dirname, '../perf/pty-drive.py'), '120', '40', '--',
    process.execPath, '--import', join(import.meta.dirname, 'fixtures/guard-brainstorm-effects.mjs'),
    join(prefix, 'node_modules/.bin/agon')], {
    cwd: scratch, encoding: 'utf8', timeout: 40_000,
    input: steps.map(step => JSON.stringify(step)).join('\n') + '\n',
    env: tuiEnv,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { forced: false, exitCode: 0 });
  // A clean exit is necessary but not sufficient: require actual dispatch,
  // rendering and persisted outcomes as well.
  const transcript = readFileSync(terminal, 'utf8').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  assert.match(transcript, /best draft \(score: \d+, confidence: 80%\)/);
  assert.match(transcript, /PACKED_BRAINSTORM_EXPANSION/);
  assert.doesNotMatch(transcript, /"bids"\s*:/);
  assert.match(transcript, /no engine produced a usable draft/);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['draft', 'draft', 'draft', 'draft', 'expansion', 'draft', 'expansion']);
  const started = JSON.parse(readFileSync(`${log}.started`, 'utf8'));
  const stopped = JSON.parse(readFileSync(`${log}.stopped`, 'utf8'));
  assert.equal(stopped.pid, started.pid);
  assert.ok(['SIGTERM', 'SIGINT'].includes(stopped.signal));
  assert.throws(() => process.kill(started.pid, 0), { code: 'ESRCH' }, 'Cancelled engine must no longer exist');
  const runs = readdirSync(join(home, 'runs')).filter(name => name.startsWith('brainstorm-'));
  assert.equal(runs.length, 4);
  for (const [index, run] of runs.sort().entries()) {
    const status = JSON.parse(readFileSync(join(home, 'runs', run, 'status.json'), 'utf8'));
    assert.equal(status.ok, index > 1);
    if (index === 1) assert.match(status.summary, /aborted/);
    assert.equal(status.engines[0].id, 'fixture-brainstorm');
  }
  return { id: 'packed-brainstorm-tui', passed: true,
    detail: 'installed npm bin on real 120x40 PTY: failed command, Escape cancellation of a running fixture engine with signal receipt and process-exit verification, two successful commands, persisted outcomes and idle double-Ctrl+C exit without forced cleanup' };
}
