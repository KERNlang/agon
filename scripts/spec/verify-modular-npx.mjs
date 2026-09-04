import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'docs/specs/evidence/modular-agon-npx-qualification.json');
const release = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-release-set.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'agon-s9-npx-'));
const packRoot = join(scratch, 'tarballs');
const ephemeral = join(scratch, 'ephemeral-npx-cache');
const home = join(scratch, 'Agon Home ü with spaces');
const npmCache = process.env.AGON_S9_NPM_CACHE || '/private/tmp/agon-s8-npm-cache-ba8c411f';
const checks = [];
const run = (executable, args, options = {}) => spawnSync(executable, args, { cwd: options.cwd ?? root, encoding: 'utf8', timeout: options.timeout ?? 15 * 60_000,
  env: { ...process.env, npm_config_ignore_scripts: 'true', npm_config_cache: npmCache, npm_config_logs_dir: join(scratch, 'npm-logs'), ...options.env } });
const requireOk = (id, result) => {
  const passed = result.status === 0 && !result.error && !result.signal;
  checks.push({ id, passed, detail: passed ? 'exit=0' : `exit=${result.status} signal=${result.signal ?? 'none'} error=${result.error ?? ''} stderr=${String(result.stderr).slice(0, 1200)}` });
  if (!passed) throw new Error(checks.at(-1).detail);
  return result;
};
const makeRemovable = (path) => { if (!existsSync(path)) return; try { chmodSync(path, 0o700); } catch {} for (const entry of readdirSync(path)) { const child = join(path, entry); try { if (lstatSync(child).isDirectory()) makeRemovable(child); else chmodSync(child, 0o600); } catch {} } };

mkdirSync(packRoot, { recursive: true });
try {
  const tarballs = {};
  for (const pkg of release.packages) {
    const result = requireOk(`pack:${pkg.id}`, run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packRoot], { cwd: join(root, pkg.directory) }));
    const packed = JSON.parse(result.stdout)[0];
    tarballs[pkg.id] = join(packRoot, packed.filename);
  }
  const cliPack = requireOk('pack:@kernlang/agon', run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packRoot], { cwd: join(root, 'packages/cli') }));
  const launcherTarball = join(packRoot, JSON.parse(cliPack.stdout)[0].filename);
  mkdirSync(ephemeral, { recursive: true });
  requireOk('ephemeral-npx-hydration', run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save=false', '--omit=optional', '--offline', '--prefix', ephemeral, launcherTarball, ...Object.values(tarballs)], { cwd: ephemeral }));
  const overrideFile = join(scratch, 'package-specs.json');
  writeFileSync(overrideFile, JSON.stringify(tarballs, null, 2));
  const cli = join(ephemeral, 'node_modules', '@kernlang', 'agon', 'dist', 'index.js');
  const setupEnv = { AGON_HOME: home, AGON_MODULAR_HOST_ROOT: join(home, 'modular-host'), AGON_SETUP_PACKAGE_SPECS_FILE: overrideFile,
    AGON_SETUP_LAUNCHER_SPEC: launcherTarball, AGON_S9_NPM_CACHE: npmCache };
  const first = requireOk('npx-setup-first-run', run(process.execPath, [cli, 'setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: setupEnv }));
  const firstJson = JSON.parse(first.stdout);
  if (firstJson.status !== 'installed' || firstJson.packageCount !== 15 || firstJson.generation !== 1) throw new Error('first setup result is not the exact expected installation');
  checks.push({ id: 'first-run-result', passed: true, detail: 'installed generation 1 with 15-package closure' });
  const stable = join(home, 'bin', 'agon');
  const smoke = requireOk('persistent-launcher-before-cache-delete', run(stable, ['--version'], { cwd: scratch, env: { AGON_HOME: home } }));
  if (!smoke.stdout.includes('1.0.0')) throw new Error('persistent launcher did not report version 1.0.0');
  makeRemovable(ephemeral); rmSync(ephemeral, { recursive: true, force: true });
  checks.push({ id: 'ephemeral-cache-deleted', passed: !existsSync(ephemeral), detail: 'ephemeral npx hydration removed' });
  requireOk('persistent-launcher-after-cache-delete', run(stable, ['--version'], { cwd: scratch, env: { AGON_HOME: home } }));
  const second = requireOk('idempotent-second-setup', run(stable, ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: { ...setupEnv, AGON_SETUP_PACKAGE_SPECS_FILE: overrideFile } }));
  const secondJson = JSON.parse(second.stdout);
  if (secondJson.status !== 'already-qualified' || secondJson.generationUnchanged !== true) throw new Error('second setup was not idempotent');
  checks.push({ id: 'idempotence-result', passed: true, detail: 'generation unchanged' });
  requireOk('managed-mod-list', run(stable, ['mod', 'list'], { cwd: scratch, env: { AGON_HOME: home } }));
  const result = { schemaVersion: 1, slice: 'S9', passed: checks.every(({ passed }) => passed), platform: `${process.platform}-${process.arch}`, node: process.version,
    profile: 'minimal+think+review', installedPackageCount: firstJson.packageCount, cacheDeletionSurvived: true, idempotent: true, checks };
  if (!process.argv.includes('--no-write')) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, installedPackageCount: firstJson.packageCount, cacheDeletionSurvived: true, idempotent: true }, null, 2));
} catch (error) {
  if (!process.argv.includes('--no-write')) writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, slice: 'S9', passed: false, platform: `${process.platform}-${process.arch}`, node: process.version, error: String(error), checks }, null, 2)}\n`);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (process.exitCode !== 1) { makeRemovable(scratch); rmSync(scratch, { recursive: true, force: true }); }
}
