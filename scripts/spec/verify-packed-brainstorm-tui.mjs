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
    tier: 'user', installHint: 'Qualification fixture only', timeout: 5,
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
  }
  steps.push({ exit: true });
  const tuiEnv = { ...env, HOME: home, AGON_HOME: home, AGON_MODULAR_HOST_ROOT: join(home, 'modular-host'),
    XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'),
    AGON_NO_UPDATE_CHECK: '1', TERM: 'xterm-256color', PTY_LOG: terminal };
  // Some terminal dependencies detect CI by key presence, not its value.
  // This is deliberately an interactive PTY even when its parent is CI.
  delete tuiEnv.CI;
  const result = spawnSync('python3', [join(import.meta.dirname, '../perf/pty-drive.py'), '120', '40', '--',
    process.execPath, '--import', join(import.meta.dirname, 'fixtures/guard-brainstorm-effects.mjs'),
    join(prefix, 'node_modules/.bin/agon')], {
    cwd: scratch, encoding: 'utf8', timeout: 30_000,
    input: steps.map(step => JSON.stringify(step)).join('\n') + '\n',
    env: tuiEnv,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  // The driver always stops its child at cleanup: its exit code alone proves
  // nothing. Require actual UI rendering, dispatch and persisted outcomes.
  const transcript = readFileSync(terminal, 'utf8').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  assert.match(transcript, /best draft \(score: \d+, confidence: 80%\)/);
  assert.match(transcript, /PACKED_BRAINSTORM_EXPANSION/);
  assert.doesNotMatch(transcript, /"bids"\s*:/);
  assert.match(transcript, /no engine produced a usable draft/);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['draft', 'draft', 'draft', 'expansion', 'draft', 'expansion']);
  const runs = readdirSync(join(home, 'runs')).filter(name => name.startsWith('brainstorm-'));
  assert.equal(runs.length, 3);
  for (const [index, run] of runs.sort().entries()) {
    const status = JSON.parse(readFileSync(join(home, 'runs', run, 'status.json'), 'utf8'));
    assert.equal(status.ok, index !== 0);
    assert.equal(status.engines[0].id, 'fixture-brainstorm');
  }
  return { id: 'packed-brainstorm-tui', passed: true,
    detail: 'installed npm bin on real 120x40 PTY: failed slash command then two successful commands, draft presentation, expansion and persisted outcomes; fixture engines; cleanup forced, not graceful-exit qualification' };
}
