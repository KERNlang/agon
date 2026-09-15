import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Real installed npm bin + parser + registry + adapter; only the engine is fake. */
export async function verifyPackedBrainstorm(prefix, scratch, env) {
  const fixture = join(import.meta.dirname, 'fixtures/brainstorm-engine.mjs');
  const guard = join(import.meta.dirname, 'fixtures/guard-brainstorm-effects.mjs');
  for (const mode of ['human', 'quiet', 'env-quiet', 'failure', 'buffered-negative-control']) {
    const home = join(scratch, `brainstorm-${mode}`);
    const gate = join(home, 'stdout-observed');
    const log = join(home, 'engine-calls');
    mkdirSync(join(home, 'engines'), { recursive: true });
    writeFileSync(join(home, 'engines/fixture-brainstorm.json'), JSON.stringify({
      schemaVersion: 3, id: 'fixture-brainstorm', displayName: 'Fixture Brainstorm',
      binary: process.execPath, searchPaths: [], versionCmd: ['--version'],
      isLocal: true, tier: 'user', installHint: 'Qualification fixture only', timeout: 5,
      exec: { args: [fixture, gate, log, mode, '{prompt}'] },
    }));
    const quiet = mode === 'quiet' || mode === 'env-quiet';
    const failed = mode === 'failure' || mode === 'buffered-negative-control';
    const args = ['--import', guard, join(prefix, 'node_modules/.bin/agon'),
      'brainstorm', 'Installed fixture question', '-e', 'fixture-brainstorm', '--timeout', '5',
      ...(mode === 'quiet' ? ['--quiet'] : [])];
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, args, { cwd: scratch, env: {
      ...env, HOME: home, AGON_HOME: home, AGON_MODULAR_HOST_ROOT: join(home, 'modular-host'),
      XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
      XDG_DATA_HOME: join(home, 'data'), AGON_QUIET: mode === 'env-quiet' ? '1' : '0',
      AGON_FIXTURE_BUFFER_STDOUT: mode === 'buffered-negative-control' ? '1' : '0',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 30_000);
      child.stdout.on('data', bytes => {
        stdout += bytes.toString();
        const firstLine = stdout.slice(0, stdout.indexOf('\n'));
        if (stdout.includes('\n') && firstLine.startsWith(quiet ? home + '/' : `AGON_RUN: ${home}/`)) {
          writeFileSync(gate, 'observed\n');
        }
      });
      child.stderr.on('data', bytes => { stderr += bytes.toString(); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', status => { clearTimeout(timer); resolve(status); });
    });
    assert.equal(code, failed ? 1 : 0, `${mode}: ${stderr}\n${stdout}`);
    const lines = stdout.trimEnd().split('\n');
    const path = quiet ? lines[0] : lines[0].replace(/^AGON_RUN: /, '');
    assert.ok(path.startsWith(home + '/'), `Run escaped isolated home: ${path}`);
    assert.equal(lines.filter(line => line === lines[0]).length, 1, 'Run path announced twice');
    assert.match(lines.at(-1), failed ? /^AGON_SUMMARY: 0\/1 succeeded/ : /^AGON_SUMMARY: 1\/1 succeeded$/);
    if (quiet) assert.equal(lines.length, 2, stdout);
    else {
      assert.match(stdout, /Brainstorm: Installed fixture question/);
      assert.match(stdout, failed ? /FAIL fixture-brainstorm:/ : /OK fixture-brainstorm:/);
      if (!failed) {
        assert.match(stdout, /Engine\tQuality\tConfidence\tReasoning/);
        assert.match(stdout, /PACKED_BRAINSTORM_EXPANSION/);
      }
    }
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    assert.deepEqual(calls, failed ? ['draft', 'draft'] : ['draft', 'expansion']);
    const status = JSON.parse(readFileSync(join(path, 'status.json'), 'utf8'));
    assert.equal(status.mode, 'brainstorm');
    assert.equal(status.ok, !failed);
    assert.equal(status.engines.length, 1);
    assert.equal(status.engines[0].id, 'fixture-brainstorm');
    assert.equal(status.engines[0].status, failed ? 'error' : 'ok');
    if (!failed) assert.match(status.summary, /winner=fixture-brainstorm; synthesis=completed/);
    if (mode === 'buffered-negative-control') {
      assert.equal(status.engines[0].detail, 'Run path was not streamed before dispatch');
    }
  }
  return { id: 'packed-brainstorm-cli', passed: true,
    detail: 'installed npm bin: human, --quiet, environment quiet, failed seat/retry; early stdout handshake with buffered-output negative control and persisted status; fixture engine only' };
}
