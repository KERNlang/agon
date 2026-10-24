import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const sandbox = mkdtempSync(join(tmpdir(), 'agon-s8-cli-e2e-'));
const home = join(sandbox, 'home');
const packageRoot = join(home, 'mods', 'hello');
const cli = join(root, 'packages/cli/dist/index.js');
let checks = 0;

function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, AGON_HOME: home, ...extraEnv },
  });
}

function ok(result, label) {
  checks += 1;
  if (result.status !== 0) throw new Error(`${label} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function jsonBeforeInstructions(stdout) {
  return JSON.parse(stdout.split('\n\nReview the plan')[0]);
}

try {
  cpSync(join(root, 'docs/examples/hello-folder-mod'), packageRoot, { recursive: true });
  const initial = JSON.parse(ok(run(['mod', 'list']), 'untrusted list'));
  checks += 1;
  if (initial.mods[0]?.status !== 'blocked') throw new Error('untrusted folder mod was not blocked');
  checks += 1;
  if (initial.view?.groups?.find(({ id }) => id === 'community')?.entries?.[0]?.status !== 'blocked' || !initial.text?.includes('Local and community mods')) {
    throw new Error('real CLI list did not expose the grouped external management view');
  }

  const trust = jsonBeforeInstructions(ok(run(['mod', 'trust', 'example.hello-folder-mod', '--allow', 'state.read', '--reason', 'isolated-e2e']), 'trust preview'));
  const badTrustApproval = run(['mod', 'approve', trust.planPath, '--approve', `sha256:${'0'.repeat(64)}`]);
  checks += 1;
  if (badTrustApproval.status === 0) throw new Error('wrong exact trust approval hash was accepted');
  ok(run(['mod', 'approve', trust.planPath, '--approve', trust.planHashes.join(',')]), 'authority approval');
  const trusted = JSON.parse(ok(run(['mod', 'list']), 'trusted-disabled list'));
  checks += 1;
  if (trusted.mods[0]?.status !== 'trusted-disabled') throw new Error('trust approval silently enabled executable code');
  const enable = jsonBeforeInstructions(ok(run(['mod', 'enable', 'example.hello-folder-mod', '--reason', 'isolated-e2e']), 'enable preview'));
  const badEnableApproval = run(['mod', 'enable', enable.planPath, '--approve', `sha256:${'0'.repeat(64)}`]);
  checks += 1;
  if (badEnableApproval.status === 0) throw new Error('wrong exact activation approval hash was accepted');
  ok(run(['mod', 'enable', enable.planPath, '--approve', enable.planHash]), 'enable');

  const invoked = JSON.parse(ok(run(['hello-folder']), 'external command'));
  checks += 1;
  if (invoked.message !== 'hello from a verified folder mod') throw new Error('external command returned the wrong result');
  checks += 1;
  if (run(['hello-folder'], { AGON_MOD_SAFE_MODE: '1' }).status === 0) throw new Error('safe mode exposed an external command');

  const runtimePath = join(packageRoot, 'dist/index.js');
  const originalRuntime = readFileSync(runtimePath, 'utf8');
  appendFileSync(runtimePath, '\n// changed after trust\n');
  checks += 1;
  if (run(['hello-folder']).status === 0) throw new Error('edited folder mod retained exact-artifact authority');
  writeFileSync(runtimePath, originalRuntime);
  ok(run(['hello-folder']), 'restored exact bytes');

  const revoke = jsonBeforeInstructions(ok(run(['mod', 'revoke', 'example.hello-folder-mod', '--capability', 'state.read', '--resources', 'example.greeting', '--reason', 'isolated-e2e']), 'grant revoke preview'));
  checks += 1;
  if (run(['mod', 'revoke', revoke.planPath, '--approve', `sha256:${'0'.repeat(64)}`]).status === 0) throw new Error('wrong exact grant-revocation hash was accepted');
  ok(run(['mod', 'revoke', revoke.planPath, '--approve', revoke.planHash]), 'grant revoke');
  ok(run(['hello-folder']), 'optional grant revocation unexpectedly disabled the mod');

  const disable = jsonBeforeInstructions(ok(run(['mod', 'disable', 'example.hello-folder-mod', '--reason', 'isolated-e2e']), 'disable preview'));
  ok(run(['mod', 'disable', disable.planPath, '--approve', disable.planHash]), 'disable');
  checks += 1;
  if (run(['hello-folder']).status === 0) throw new Error('disabled external command remained reachable');

  const untrust = jsonBeforeInstructions(ok(run(['mod', 'untrust', 'example.hello-folder-mod', '--reason', 'isolated-e2e']), 'untrust preview'));
  checks += 1;
  if (run(['mod', 'approve', untrust.planPath, '--approve', `sha256:${'0'.repeat(64)}`]).status === 0) throw new Error('wrong exact untrust hash was accepted');
  ok(run(['mod', 'approve', untrust.planPath, '--approve', untrust.planHashes.join(',')]), 'untrust');
  const revoked = JSON.parse(ok(run(['mod', 'list']), 'revoked list'));
  checks += 1;
  if (revoked.mods[0]?.status !== 'blocked') throw new Error('revoked artifact remained trusted');

  writeFileSync(join(home, 'modular-host', 'trust', 'corrupt.json'), '{corrupt authority');
  const corruptAuthority = JSON.parse(ok(run(['mod', 'list']), 'list with corrupt authority state'));
  checks += 1;
  if (corruptAuthority.mods[0]?.status !== 'blocked' || !corruptAuthority.mods[0]?.authorityError?.includes('authority record filename must be a UUID')
    || !corruptAuthority.text?.includes('Authority state is unreadable') || !corruptAuthority.text?.includes('Run agon doctor')) {
    throw new Error('corrupt authority state crashed management or lacked visible recovery guidance');
  }
  checks += 1;
  if (run(['hello-folder']).status === 0) throw new Error('corrupt authority state allowed external execution');

  console.log(JSON.stringify({
    schemaVersion: 1,
    verifier: 'modular-folder-mod-cli-e2e',
    checks,
    passed: true,
  }, null, 2));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
