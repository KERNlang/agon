#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { channelProblems, expectedNames, NOT_INSTALLED, setDifferences, updatePlanProblems } from './gate-expectations.mjs';
import { INDEPENDENT_PACKAGES, LAUNCHER, REPO_ROOT, isFamilyPackage } from './release-plan.mjs';

const { values } = parseArgs({ options: {
  tarballs: { type: 'string' },
  only: { type: 'string' },
  substitute: { type: 'string' },
  'keep-work': { type: 'boolean', default: false },
} });
if (!values.tarballs) throw new Error('usage: install-gate.mjs --tarballs <dir> [--only a,b] [--substitute name=npm-spec] [--keep-work]');

const FAKE_ENGINE_ID = 'release-gate-fixture';
const FAKE_ENGINE_MARKER = 'RELEASE_GATE_FIXTURE_OK';
const INHERITED_ENV = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL'];

const tarballDir = resolve(values.tarballs);
const manifest = JSON.parse(readFileSync(join(tarballDir, 'release-manifest.json'), 'utf8'));
const only = values.only ? new Set(values.only.split(',')) : null;
const entries = manifest.packages.filter(({ name }) => !only || only.has(name));
const launcher = entries.find(({ name }) => name === LAUNCHER);
if (!launcher) throw new Error(`${LAUNCHER} is not among the tarballs under test`);
// Negative control only: installs one package from elsewhere, which must turn the gate RED.
const [substituteName, substituteSpec] = values.substitute?.split('=') ?? [];

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
  const inherited = Object.fromEntries(INHERITED_ENV.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  return { ...inherited, HOME: home, USERPROFILE: home, AGON_HOME: join(home, '.agon'),
    AGON_MODULAR_HOST_ROOT: join(home, 'modular-host'), XDG_CONFIG_HOME: join(home, 'config'),
    XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'), CI: '1', NO_COLOR: '1' };
}

function agon(args, timeout = 120_000) {
  return spawnSync(join(prefix, 'node_modules/.bin/agon'), args, {
    cwd: work, env: isolatedEnv(), encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
}

function runAgonCheck(id, args, findMissing) {
  const result = agon(args);
  const missing = findMissing(result);
  const passed = result.status === 0 && missing.length === 0;
  check(id, passed, `exit=${result.status}${missing.length ? ` missing=${JSON.stringify(missing)}` : ''}`);
  if (!passed) console.log(`${result.stdout}${result.stderr}`.slice(-1500));
}

const contains = (...texts) => ({ stdout, stderr }) => texts.filter((text) => !`${stdout}${stderr}`.includes(text));
// consola prefixes plain output with [log] when CI is set.
const printsExactly = (text) => ({ stdout }) => (stdout.trim().replace(/^\[log\] /, '') === text ? [] : [text]);
const listsCommands = (...commands) => ({ stdout }) => commands.filter((command) => !new RegExp(`^\\s*\`?${command}\`?\\s`, 'm').test(stdout));

function integrityOf(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
}

function filesIn(root, relative = '') {
  return readdirSync(join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (!entry.isDirectory()) return [path];
    return path === 'node_modules' ? [] : filesIn(root, path);
  });
}

function installedFamilyPackages(nodeModules) {
  if (!existsSync(nodeModules)) return [];
  return readdirSync(nodeModules).filter((name) => !name.startsWith('.')).flatMap((name) => {
    const names = name.startsWith('@') ? readdirSync(join(nodeModules, name)).map((inner) => `${name}/${inner}`) : [name];
    return names.flatMap((packageName) => {
      const directory = join(nodeModules, packageName);
      const nested = installedFamilyPackages(join(directory, 'node_modules'));
      return isFamilyPackage(packageName) ? [{ name: packageName, directory }, ...nested] : nested;
    });
  });
}

function differenceFromTarball({ name, directory }) {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) return `${name} has no release tarball`;
  if (lstatSync(directory).isSymbolicLink()) return `${name} is a symlink`;
  const unpacked = mkdtempSync(join(work, 'unpacked-'));
  const extracted = spawnSync('tar', ['-xzf', join(tarballDir, entry.filename), '-C', unpacked], { env: isolatedEnv() });
  if (extracted.status !== 0) return `${name} tarball does not extract`;
  const packed = join(unpacked, 'package');
  const packedFiles = filesIn(packed).sort();
  const installedFiles = filesIn(directory).sort();
  const changed = [...new Set([...packedFiles, ...installedFiles])].filter((path) => !packedFiles.includes(path)
    || !installedFiles.includes(path) || !readFileSync(join(packed, path)).equals(readFileSync(join(directory, path))));
  return changed.length ? `${name} differs at ${changed.slice(0, 3).join(' ')}` : null;
}

function installConsumer() {
  mkdirSync(prefix, { recursive: true });
  mkdirSync(home, { recursive: true });
  const unapproved = entries.filter(({ filename, integrity }) => integrityOf(join(tarballDir, filename)) !== integrity).map(({ name }) => name);
  if (!check('every tarball matches its manifest integrity', unapproved.length === 0, unapproved.join(','))) return false;
  const specFor = ({ name, filename }) => (name === substituteName ? substituteSpec : `file:${join(tarballDir, filename)}`);
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
  const fromElsewhere = Object.entries(lock)
    .filter(([path, locked]) => {
      const name = path.split('node_modules/').at(-1);
      if (!isFamilyPackage(name)) return false;
      const packed = entries.find((entry) => entry.name === name);
      return !packed || !String(locked.resolved ?? '').startsWith('file:') || locked.integrity !== packed.integrity;
    }).map(([path]) => path);
  check('every first-party package comes from a release tarball', fromElsewhere.length === 0, fromElsewhere.join(','));

  const installedFamily = installedFamilyPackages(join(prefix, 'node_modules'));
  const setProblems = setDifferences('install', installedFamily.map(({ name }) => name), expectedNames(entries, NOT_INSTALLED));
  check('the installed first-party set equals the packed set', setProblems.length === 0, setProblems.join('; ') || `excepted=${[...NOT_INSTALLED.keys()].join(',')}`);

  const differing = installedFamily.map(differenceFromTarball).filter(Boolean);
  check('every installed first-party package holds the packed bytes', differing.length === 0, differing.join('; '));

  const launcherManifest = JSON.parse(readFileSync(join(prefix, 'node_modules/@kernlang/agon/package.json'), 'utf8'));
  const declared = { ...launcherManifest.dependencies, ...launcherManifest.optionalDependencies };
  const absent = Object.keys(declared).filter((name) => {
    if (!name.startsWith('@kernlang/') || INDEPENDENT_PACKAGES.has(name)) return false;
    return !Object.hasOwn(lock, `node_modules/${name}`);
  });
  check('every declared first-party dependency is installed, including optional mods', absent.length === 0, absent.join(','));

  const channel = JSON.parse(readFileSync(join(prefix, 'node_modules/@kernlang/agon/release-channel.json'), 'utf8'));
  const pinProblems = channelProblems(channel, entries);
  check('release channel pins exactly the packed bytes', pinProblems.length === 0, pinProblems.join('; '));
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
  runAgonCheck('agon --version', ['--version'], printsExactly(launcher.version));
  runAgonCheck('agon --help', ['--help'], listsCommands('forge', 'review', 'ask', 'update', 'mod', 'setup'));
  writeFakeEngine();
  runAgonCheck('agon engine list', ['engine', 'list'], contains(FAKE_ENGINE_ID));
  runAgonCheck('agon mod list', ['mod', 'list'], contains('[enabled] Ask', '[enabled] Forge', '[enabled] Review'));
  runAgonCheck('agon ask via fake engine', ['ask', FAKE_ENGINE_ID, 'release gate question', '--timeout', '30'], printsExactly(FAKE_ENGINE_MARKER));
  const plan = agon(['update', '--plan'], 300_000);
  let planned = null;
  try { planned = JSON.parse(plan.stdout); } catch { planned = null; }
  const planProblems = updatePlanProblems(planned, launcher, entries);
  const planPassed = check('agon update --plan', plan.status === 0 && planProblems.length === 0, `exit=${plan.status}${planProblems.length ? ` problems=${JSON.stringify(planProblems)}` : ''}`);
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
