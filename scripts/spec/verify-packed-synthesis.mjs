import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Exercise the installed CLI; only provider responses are fixtures. */
export async function verifyPackedSynthesis(prefix, scratch, env) {
  const fixture = join(import.meta.dirname, 'fixtures/synthesis-engine.mjs');
  const marker = 'Heads up: `agon synthesis` picks a winner by LLM judgment with no fitness test.';
  const advice = marker + ' If this task produces code you can test, prefer `agon forge -t "<test>"` — it selects by'
    + " proven correctness and won't crown a confident-but-wrong artifact. If it's design, prose,"
    + ' or tradeoffs with no clean pass/fail, synthesis is the right tool — carry on.';
  for (const mode of ['code', 'prose', 'quiet', 'env-quiet', 'hidden-negative', 'delayed-negative']) {
    const home = join(scratch, `synthesis-${mode}`);
    const log = join(home, 'engine-calls');
    const negative = mode.endsWith('-negative');
    const expectedAdvice = mode === 'code' || negative;
    mkdirSync(join(home, 'engines'), { recursive: true });
    writeFileSync(join(home, 'engines/fixture-synthesis.json'), JSON.stringify({
      schemaVersion: 3, id: 'fixture-synthesis', displayName: 'Fixture Synthesis',
      binary: process.execPath, searchPaths: [], versionCmd: ['--version'],
      isLocal: true, tier: 'user', installHint: 'Qualification fixture only', timeout: 5,
      exec: { args: [fixture, log, '{prompt}'] },
    }));
    const args = ['--import', fixture, join(prefix, 'node_modules/.bin/agon'), 'synthesis',
      mode === 'prose' ? 'Write a README explaining the architecture' : 'fix the login crash',
      '-e', 'fixture-synthesis', '--swaps', '0', '--timeout', '5',
      ...(mode === 'quiet' ? ['--quiet'] : [])];
    let stdout = '', stderr = '';
    const child = spawn(process.execPath, args, { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...env, HOME: home, AGON_HOME: home, AGON_MODULAR_HOST_ROOT: join(home, 'modular-host'),
      XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'),
      AGON_QUIET: mode === 'env-quiet' ? '1' : '0', AGON_FORCE_HEALTH_PROBE: '', AGON_DISABLE_FORGE_HEALTH_CHECK: '1',
      AGON_FIXTURE_HIDE_ADVICE: mode === 'hidden-negative' ? '1' : '0',
      AGON_FIXTURE_DELAY_ADVICE: mode === 'delayed-negative' ? '1' : '0',
      AGON_FIXTURE_REQUIRE_ADVICE: expectedAdvice ? '1' : '0',
    } });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.stdout.on('data', bytes => {
        stdout += bytes.toString();
      });
      child.stderr.on('data', bytes => { stderr += bytes.toString(); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', status => { clearTimeout(timer); resolve(status); });
    });
    assert.equal(code, negative ? 1 : 0, `${mode}: ${stderr}\n${stdout}`);
    if (negative) {
      assert.match(stderr, /Routing warning not written before provider dispatch/);
      assert.equal(existsSync(log), false, 'Provider started before advice');
      continue;
    }
    assert.equal(stdout.includes(marker), false, 'Routing advice polluted JSON stdout');
    assert.equal(stderr.split(marker).length - 1, mode === 'code' ? 1 : 0, mode);
    if (mode === 'code') assert.ok(stderr.includes(`\u001b[33m⚠\u001b[0m ${advice}\n`));
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    assert.deepEqual(calls, ['draft', 'judge']);
    if (mode === 'quiet') assert.equal(stdout, 'fixture-synthesis: fixture\n');
    else {
      const result = JSON.parse(stdout);
      assert.equal(result.winner, 'fixture-synthesis');
      assert.equal(result.judgeReasoning, 'fixture');
      assert.equal(stdout, JSON.stringify(result, null, 2) + '\n');
    }
  }
  return { id: 'packed-synthesis-cli-advice', passed: true,
    detail: 'installed CLI code/prose/flag quiet/environment quiet; JSON-only stdout and stderr advice; synchronous stderr-before-spawn check; suppressed/delayed warning negative controls; fake engine only' };
}
