#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { INDEPENDENT_PACKAGES, LAUNCHER, REPO_ROOT, isFamilyPackage } from './release-plan.mjs';

const { values } = parseArgs({ options: {
  tarballs: { type: 'string' },
  only: { type: 'string' },
  'keep-work': { type: 'boolean', default: false },
} });
if (!values.tarballs) throw new Error('usage: install-gate.mjs --tarballs <dir> [--only a,b] [--keep-work]');

const FAKE_ENGINE_ID = 'release-gate-fixture';
const FAKE_ENGINE_MARKER = 'RELEASE_GATE_FIXTURE_OK';
const CREDENTIAL_ENV = /(_API_KEY|_TOKEN|_SECRET|_AUTH|PASSWORD)$/i;

const tarballDir = resolve(values.tarballs);
const manifest = JSON.parse(readFileSync(join(tarballDir, 'release-manifest.json'), 'utf8'));
const only = values.only ? new Set(values.only.split(',')) : null;
const entries = manifest.packages.filter(({ name }) => !only || only.has(name));
const launcher = entries.find(({ name }) => name === LAUNCHER);
if (!launcher) throw new Error(`${LAUNCHER} is not among the tarballs under test`);

const work = mkdtempSync(join(process.env.RELEASE_GATE_TMP ?? tmpdir(), 'agon-install-gate-'));
const prefix = join(work, 'consumer');
const home = join(work, 'home');
const failures = [];

function check(id, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id}${detail ? ` ${detail}` : ''}`);
  if (!passed) failures.push(id);
  return passed;
}

function isolatedEnv() {
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !CREDENTIAL_ENV.test(key) && !key.startsWith('npm_') && !key.startsWith('NODE_') && !key.startsWith('AGON_')));
  return { ...env, HOME: home, USERPROFILE: home, AGON_HOME: join(home, '.agon'),
    AGON_MODULAR_HOST_ROOT: join(home, 'modular-host'), XDG_CONFIG_HOME: join(home, 'config'),
    XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'), CI: '1', NO_COLOR: '1' };
}

function agon(args, timeout = 120_000) {
  return spawnSync(join(prefix, 'node_modules/.bin/agon'), args, {
    cwd: work, env: isolatedEnv(), encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
}

function runAgonCheck(id, args, expected) {
  const result = agon(args);
  const output = `${result.stdout}${result.stderr}`;
  const missing = expected.filter((text) => !output.includes(text));
  const passed = result.status === 0 && missing.length === 0;
  check(id, passed, `exit=${result.status}${missing.length ? ` missing=${JSON.stringify(missing)}` : ''}`);
  if (!passed) console.log(output.slice(-1500));
  return output;
}

function installConsumer() {
  mkdirSync(prefix, { recursive: true });
  mkdirSync(home, { recursive: true });
  const specFor = ({ filename }) => `file:${join(tarballDir, filename)}`;
  writeFileSync(join(prefix, 'package.json'), `${JSON.stringify({
    name: 'agon-release-gate-consumer', version: '0.0.0', private: true,
    dependencies: { [LAUNCHER]: specFor(launcher) },
    overrides: Object.fromEntries(entries.filter(({ name }) => name !== LAUNCHER).map((entry) => [entry.name, specFor(entry)])),
  }, null, 2)}\n`);
  const installed = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], {
    cwd: prefix, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024,
    env: { ...isolatedEnv(), npm_config_cache: join(work, 'npm-cache') },
  });
  const passed = check(`npm install from ${entries.length} tarballs`, installed.status === 0, `exit=${installed.status}`);
  if (!passed) console.log(`${installed.stdout}${installed.stderr}`.split('\n').filter((line) => !line.includes(' verbose ')).slice(0, 12).join('\n'));
  return passed;
}

function checkInstalledGraph() {
  const scope = join(prefix, 'node_modules/@kernlang');
  const symlinks = readdirSync(scope).filter((name) => lstatSync(join(scope, name)).isSymbolicLink());
  check('no workspace symlinks in the install', symlinks.length === 0, symlinks.join(','));

  const agonBin = realpathSync(join(prefix, 'node_modules/.bin/agon'));
  check('agon resolves outside the repository', !agonBin.startsWith(`${realpathSync(REPO_ROOT)}${sep}`), agonBin);

  const lock = JSON.parse(readFileSync(join(prefix, 'package-lock.json'), 'utf8')).packages;
  const fromTarball = new Set(entries.map(({ name }) => name));
  const fromRegistry = Object.entries(lock)
    .filter(([path, entry]) => {
      const name = path.split('node_modules/').at(-1);
      return isFamilyPackage(name) && !fromTarball.has(name) && !String(entry.resolved ?? '').startsWith('file:');
    }).map(([path]) => path);
  check('every first-party package comes from a release tarball', fromRegistry.length === 0, fromRegistry.join(','));

  const launcherManifest = JSON.parse(readFileSync(join(prefix, 'node_modules/@kernlang/agon/package.json'), 'utf8'));
  const declared = { ...launcherManifest.dependencies, ...launcherManifest.optionalDependencies };
  const absent = Object.keys(declared).filter((name) => {
    if (!name.startsWith('@kernlang/') || INDEPENDENT_PACKAGES.has(name)) return false;
    return !Object.hasOwn(lock, `node_modules/${name}`);
  });
  check('every declared first-party dependency is installed, including optional mods', absent.length === 0, absent.join(','));

  const channel = JSON.parse(readFileSync(join(prefix, 'node_modules/@kernlang/agon/release-channel.json'), 'utf8'));
  const stale = [...channel.packages, ...channel.compatibilityArtifacts].filter((pinned) => {
    const packed = entries.find(({ name }) => name === pinned.id);
    return !packed || packed.integrity !== pinned.integrity;
  }).map(({ id }) => id);
  check('release channel pins exactly the packed bytes', stale.length === 0, stale.join(','));
}

function writeFakeEngine() {
  const script = join(work, 'fake-engine.mjs');
  writeFileSync(script, `process.stdout.write(${JSON.stringify(FAKE_ENGINE_MARKER)} + '\\n');\n`);
  const engines = join(home, '.agon/engines');
  mkdirSync(engines, { recursive: true });
  writeFileSync(join(engines, `${FAKE_ENGINE_ID}.json`), JSON.stringify({
    schemaVersion: 3, id: FAKE_ENGINE_ID, displayName: 'Release gate fixture', binary: process.execPath,
    searchPaths: [], versionCmd: ['--version'], isLocal: true, tier: 'user', installHint: 'Release gate fixture only',
    timeout: 30, exec: { args: [script, '{prompt}'] },
  }));
}

function checkCommands() {
  runAgonCheck('agon --version', ['--version'], [launcher.version]);
  runAgonCheck('agon --help', ['--help'], ['forge', 'review', 'mod']);
  writeFakeEngine();
  runAgonCheck('agon engine list', ['engine', 'list'], [FAKE_ENGINE_ID]);
  runAgonCheck('agon mod list', ['mod', 'list'], ['[enabled] Ask', '[enabled] Forge', '[enabled] Review']);
  runAgonCheck('agon ask via fake engine', ['ask', FAKE_ENGINE_ID, 'release gate question', '--timeout', '30'], [FAKE_ENGINE_MARKER]);
  const plan = agon(['update', '--plan'], 300_000);
  let planned = null;
  try { planned = JSON.parse(plan.stdout); } catch { planned = null; }
  const planPassed = check('agon update --plan', plan.status === 0 && planned?.status === 'planned', `exit=${plan.status}`);
  if (!planPassed) console.log(`${plan.stdout}${plan.stderr}`.slice(-1500));
}

let exitCode = 1;
try {
  console.log(`install gate: ${entries.length} tarball(s) for ${LAUNCHER}@${launcher.version} in ${work}`);
  if (installConsumer()) {
    checkInstalledGraph();
    checkCommands();
  }
  console.log(failures.length ? `INSTALL GATE RED: ${failures.length} check(s) failed` : 'INSTALL GATE GREEN');
  exitCode = failures.length ? 1 : 0;
} finally {
  if (!values['keep-work']) rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
