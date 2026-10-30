import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Exercise installed CLI output with only the provider response replaced. */
export function verifyPackedSynthesisPresentation(prefix, scratch, env) {
  const fixture = join(import.meta.dirname, 'fixtures/synthesis-presentation-engine.mjs');
  for (const mode of ['human', 'quiet', 'environment', 'jsonl', 'hidden-path-negative']) {
    const home = join(scratch, `synthesis-presentation-${mode}`);
    const log = join(home, 'engine-calls');
    mkdirSync(join(home, 'engines'), { recursive: true });
    writeFileSync(join(home, 'engines/fixture-synthesis.json'), JSON.stringify({
      schemaVersion: 3, id: 'fixture-synthesis', displayName: 'Fixture Synthesis',
      binary: process.execPath, searchPaths: [], versionCmd: ['--version'],
      isLocal: true, tier: 'user', installHint: 'Qualification fixture only', timeout: 5,
      exec: { args: [fixture, log, '{prompt}'] },
    }));
    const negative = mode === 'hidden-path-negative';
    const quiet = mode === 'quiet' || mode === 'environment';
    const jsonl = mode === 'jsonl';
    const run = spawnSync(process.execPath, [...(jsonl ? [] : ['--import', fixture]), join(prefix, 'node_modules/.bin/agon'),
      ...(jsonl ? ['call'] : []),
      'synthesis', 'Installed presentation fixture', '-e', 'fixture-synthesis', '--swaps', '0', '--timeout', '5',
      ...(jsonl ? ['--jsonl'] : []),
      ...(mode === 'quiet' ? ['--quiet'] : [])], {
      cwd: scratch, encoding: 'utf8', timeout: 30_000, env: {
        ...env, HOME: home, AGON_HOME: home, AGON_MODULAR_HOST_ROOT: join(home, 'modular-host'),
        XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'),
        AGON_QUIET: mode === 'environment' ? '1' : '0', AGON_FORCE_HEALTH_PROBE: '', AGON_DISABLE_FORGE_HEALTH_CHECK: '1',
        AGON_FIXTURE_FLAG_QUIET: mode === 'quiet' ? '1' : '0', AGON_FIXTURE_HIDE_PATH: negative ? '1' : '0',
      },
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, negative ? 1 : 0, `${mode}: ${run.stderr}\n${run.stdout}`);
    if (negative) {
      assert.equal(existsSync(log), false, 'Provider dispatched before the path was emitted');
      continue;
    }
    let report = run.stdout;
    if (jsonl) {
      const events = report.trimEnd().split('\n').map(line => JSON.parse(line));
      for (const event of events) assert.ok(Number.isFinite(Date.parse(event.timestamp)), 'Missing event timestamp');
      assert.equal(events.filter(event => event.type === 'agon.call.start').length, 1);
      assert.equal(events.filter(event => event.type === 'agon.call.command.start').length, 1);
      const completed = events.filter(event => event.type === 'agon.call.command.done');
      assert.equal(completed.length, 1);
      assert.equal(completed[0].exitCode, 0);
      assert.equal(events.filter(event => event.type === 'agon.call.done').length, 1);
      assert.equal(events.at(-1).type, 'agon.call.done');
      assert.equal(events.at(-1).ok, true);
      assert.equal(events.at(-1).exitCode, 0);
      report = events.filter(event => event.type === 'agon.call.stdout').map(event => event.data).join('');
    }
    const stdout = report.replace(/\u001b\[[0-9;]*m/g, '');
    const lines = stdout.trimEnd().split('\n');
    const path = quiet ? lines[0] : lines[0].replace(/^AGON_RUN: /, '');
    assert.ok(path.startsWith(home + '/runs/'), path);
    assert.equal(lines.filter(line => line === lines[0]).length, 1);
    assert.equal(lines.at(-1), 'AGON_SUMMARY: 1/1 succeeded');
    assert.equal(lines.filter(line => line.startsWith('AGON_SUMMARY:')).length, 1);
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['draft', 'judge']);
    if (quiet) assert.equal(lines.length, 2, stdout);
    else {
      const markers = ['Synthesis: Installed presentation fixture', 'Initial Drafts', 'PACKED_SYNTHESIS_DRAFT',
        'Judge Scores', 'Winner:', 'fixture verdict', `Full output saved: ${path}`, 'AGON_SUMMARY:'];
      let offset = -1;
      for (const marker of markers) { const next = stdout.indexOf(marker, offset + 1); assert.ok(next > offset, `${mode}: missing or reordered ${marker}`); offset = next; }
    }
    const status = JSON.parse(readFileSync(join(path, 'status.json'), 'utf8'));
    assert.equal(status.ok, true);
    assert.equal(status.summary, '1/1 drafted; winner=fixture-synthesis');
    assert.deepEqual(status.engines, [{ id: 'fixture-synthesis', status: 'ok', detail: 'draft, score=90 * winner' }]);
  }
  return { id: 'packed-synthesis-cli-presentation', passed: true,
    detail: 'installed human/flag quiet/environment quiet/JSONL bridge, persisted status, output-before-provider negative control; fixture engine only' };
}
