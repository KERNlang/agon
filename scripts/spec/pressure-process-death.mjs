// Actual OS process death, not SimulatedHostCrash. Candidate checkout only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const candidate = resolve(process.argv[2]);
const moduleUrl = pathToFileURL(join(candidate, 'packages/mod-kernel/dist/index.js')).href;
const scratch = mkdtempSync(join(tmpdir(), 'pressure-real-death-'));
const phases = {
  'after-lock': 1, 'after-journal-preparing': 1, 'after-staging': 1,
  'after-journal-verified': 1, 'after-generation-rename': 1,
  'after-pointer-switch': 2, 'after-journal-committed': 2,
  'after-installed-index': 2, 'after-final-journal': 2,
};
const checks = [];
for (const [phase, expected] of Object.entries(phases)) {
  const home = join(scratch, phase);
  const common = `
    import { DurableModHost } from ${JSON.stringify(moduleUrl)};
    const home = ${JSON.stringify(home)};
    const lock = (c) => ({schemaVersion:1,kernelVersion:'1.0.0',apiVersion:'1.0.0',
      desiredStateHash:'sha256:'+'d'.repeat(64),graphHash:'sha256:'+c.repeat(64),packages:[]});
    const input = (c) => ({operation:'update',lock:lock(c),desiredState:{value:c},installedIndex:{value:c}});
  `;
  const run = (source) => spawnSync(process.execPath, ['--input-type=module', '-e', common + source], {
    cwd: candidate, env: process.env, encoding: 'utf8', timeout: 30_000,
  });
  const initial = run(`const host = new DurableModHost(home,{kernelVersion:'1.0.0'}); await host.commitGeneration(input('a'));`);
  assert.equal(initial.status, 0, initial.stderr);
  const killed = run(`const host = new DurableModHost(home,{kernelVersion:'1.0.0',
    fault: (point) => { if (point === ${JSON.stringify(phase)}) process.kill(process.pid,'SIGKILL'); }});
    await host.commitGeneration(input('b'));`);
  assert.equal(killed.signal, 'SIGKILL', `writer did not die at ${phase}: ${killed.stderr}`);
  const recovery = run(`const host = new DurableModHost(home,{kernelVersion:'1.0.0'});
    await host.recoverStaleWriter(async (pid) => {
      try { process.kill(pid,0); return true; } catch (error) { if(error.code==='ESRCH') return false; throw error; }
    });
    const boot = await host.boot(); console.log(JSON.stringify(boot));`);
  assert.equal(recovery.status, 0, recovery.stderr);
  const observed = JSON.parse(recovery.stdout);
  const verify = (generation) => {
    assert.equal(observed.mode, 'normal');
    assert.equal(observed.pointer.generation, generation);
    assert.equal(observed.pointer.graphHash, 'sha256:' + (generation === 1 ? 'a' : 'b').repeat(64));
  };
  verify(expected);
  // Negative control: the opposite side of the commit point must be rejected.
  assert.throws(() => verify(expected === 1 ? 2 : 1));
  // A new writer must work after recovery, not merely read a plausible pointer.
  const reentry = run(`const host = new DurableModHost(home,{kernelVersion:'1.0.0'});
    await host.commitGeneration(input('c')); console.log(JSON.stringify(await host.boot()));`);
  assert.equal(reentry.status, 0, reentry.stderr);
  const entered = JSON.parse(reentry.stdout);
  assert.equal(entered.mode, 'normal');
  assert.ok(entered.pointer.generation > expected);
  assert.equal(entered.pointer.graphHash, 'sha256:' + 'c'.repeat(64));
  checks.push({ phase, signal: killed.signal, recoveredGeneration: expected, reenteredGeneration: entered.pointer.generation, negativeControlKilled: true });
}
console.log(JSON.stringify({ passed: true, checks, retainedFixture: scratch }, null, 2));
