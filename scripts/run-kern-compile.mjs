#!/usr/bin/env node

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function normalizeRequirement(range) {
  if (!range) return null;
  const match = range.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function parseVersion(value) {
  if (!value) return null;
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function resolvePath(input, baseDir = process.cwd()) {
  if (!input) return null;
  return path.isAbsolute(input) ? input : path.resolve(baseDir, input);
}

function resolveOverridePath(input) {
  if (!input) return null;
  if (path.isAbsolute(input)) return input;

  const fromRepoRoot = path.resolve(repoRoot, input);
  if (existsSync(fromRepoRoot)) {
    return fromRepoRoot;
  }

  return path.resolve(process.cwd(), input);
}

function readPackageVersion(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const pkg = readJson(filePath);
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

function inspectCommandVersion(command, args = []) {
  const result = spawnSync(command, [...args, '--version'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || result.stderr.trim() || null;
}

function findPackageRoot(startPath) {
  let current = startPath;

  try {
    current = realpathSync(startPath);
  } catch {
    current = startPath;
  }

  let dir = path.extname(current) ? path.dirname(current) : current;

  while (dir && dir !== path.dirname(dir)) {
    const packageJson = path.join(dir, 'package.json');
    if (existsSync(packageJson)) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return null;
}

function readEffectiveKernVersion(cliPackageRoot) {
  if (!cliPackageRoot) return null;

  const probePaths = [
    path.resolve(cliPackageRoot, '../core/dist/spec.js'),
    path.resolve(cliPackageRoot, '../core/src/spec.ts'),
  ];

  for (const probePath of probePaths) {
    if (!existsSync(probePath)) continue;
    const source = readFileSync(probePath, 'utf8');
    const match = source.match(/KERN_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function describeCandidate(label, command, commandArgs, packageVersion, effectiveVersion = null, allowStale = false) {
  return {
    label,
    command,
    commandArgs,
    packageVersion,
    effectiveVersion,
    allowStale,
  };
}

function isNodeEntrypoint(filePath) {
  return /\.(c|m)?js$/i.test(filePath);
}

function collectCandidates() {
  const rootPackageJson = readJson(path.join(repoRoot, 'package.json'));
  const requiredVersion = normalizeRequirement(rootPackageJson.optionalDependencies?.['@kernlang/cli']);
  const envBin = process.env.KERN_BIN?.trim();
  const envPath = resolveOverridePath(envBin);
  const installedCli = path.join(repoRoot, 'node_modules/.bin/kern');
  const installedPkg = path.join(repoRoot, 'node_modules/@kernlang/cli/package.json');

  const candidates = [];

  if (envBin) {
    if (envPath && existsSync(envPath)) {
      const envIsNodeEntrypoint = isNodeEntrypoint(envPath);
      const cliPackageRoot = findPackageRoot(envPath);
      candidates.push(
        describeCandidate(
          `KERN_BIN (${envPath})`,
          envIsNodeEntrypoint ? process.execPath : envPath,
          envIsNodeEntrypoint ? [envPath] : [],
          readPackageVersion(
            path.join(path.dirname(path.dirname(envPath)), 'package.json'),
          ) ?? (
            envIsNodeEntrypoint
              ? inspectCommandVersion(process.execPath, [envPath])
              : inspectCommandVersion(envPath)
          ),
          readEffectiveKernVersion(cliPackageRoot),
          true,
        ),
      );
    } else {
      candidates.push(
        describeCandidate(
          `KERN_BIN (${envBin})`,
          envBin,
          [],
          inspectCommandVersion(envBin),
          null,
          true,
        ),
      );
    }
  }

  if (existsSync(installedCli)) {
    candidates.push(
      describeCandidate(
        `workspace @kernlang/cli (${installedCli})`,
        installedCli,
        [],
        readPackageVersion(installedPkg),
        readEffectiveKernVersion(path.join(repoRoot, 'node_modules/@kernlang/cli')),
      ),
    );
  }

  candidates.push(
    describeCandidate(
      'PATH kern',
      'kern',
      [],
      inspectCommandVersion('kern'),
      null,
      false,
    ),
  );

  return { candidates, requiredVersion };
}

function selectCandidate(candidates, requiredVersion) {
  const requiredParts = parseVersion(requiredVersion);
  const rejected = [];

  for (const candidate of candidates) {
    const version = candidate.effectiveVersion ?? candidate.packageVersion;
    const parsedVersion = parseVersion(version);

    if (!candidate.allowStale && requiredParts && parsedVersion && compareVersions(parsedVersion, requiredParts) < 0) {
      const versionNote = candidate.effectiveVersion && candidate.packageVersion && candidate.effectiveVersion !== candidate.packageVersion
        ? `${candidate.effectiveVersion} (declares ${candidate.packageVersion})`
        : version;
      rejected.push(`${candidate.label} -> ${versionNote}`);
      continue;
    }

    if (!candidate.allowStale && requiredParts && !parsedVersion) {
      rejected.push(`${candidate.label} -> unknown version`);
      continue;
    }

    return {
      candidate,
      rejected,
      version: version ?? 'unknown',
    };
  }

  return { candidate: null, rejected, version: null };
}

function runCommand(command, args, label) {
  console.log(`  [kern:compile using ${label}]`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`  [kern:compile failed to launch ${label}: ${result.error.message}]`);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

const [srcDir, outDir, ...rawArgs] = process.argv.slice(2);

if (!srcDir || !outDir) {
  console.error('Usage: node scripts/run-kern-compile.mjs <srcDir> <outDir> [kern args...] [--postcompile=<script>]');
  process.exit(1);
}

let postcompile = null;
const compilerArgs = [];

for (const arg of rawArgs) {
  if (arg.startsWith('--postcompile=')) {
    postcompile = arg.slice('--postcompile='.length);
    continue;
  }
  compilerArgs.push(arg);
}

const { candidates, requiredVersion } = collectCandidates();
const selection = selectCandidate(candidates, requiredVersion);

if (!selection.candidate) {
  console.error('  [kern:compile could not find a suitable Kern CLI]');
  if (requiredVersion) {
    console.error(`  [kern:compile requires @kernlang/cli >= ${requiredVersion}]`);
  }
  if (selection.rejected.length > 0) {
    console.error(`  [kern:compile rejected stale candidates: ${selection.rejected.join('; ')}]`);
  }
  console.error('  [kern:compile install the pinned @kernlang/cli family or set KERN_BIN to an explicit override]');
  process.exit(1);
}

if (requiredVersion && !selection.candidate.allowStale && selection.version !== 'unknown') {
  const declaredVersion = selection.candidate.packageVersion;
  if (selection.candidate.effectiveVersion && declaredVersion && selection.candidate.effectiveVersion !== declaredVersion) {
    console.log(
      `  [kern:compile resolved effective ${selection.candidate.effectiveVersion}; package declares ${declaredVersion}; required >= ${requiredVersion}]`,
    );
  } else {
    console.log(`  [kern:compile resolved ${selection.version}; required >= ${requiredVersion}]`);
  }
} else if (selection.version !== 'unknown') {
  console.log(`  [kern:compile resolved ${selection.version}]`);
}

runCommand(
  selection.candidate.command,
  [...selection.candidate.commandArgs, 'compile', srcDir, `--outdir=${outDir}`, ...compilerArgs],
  selection.candidate.label,
);

if (postcompile) {
  const postcompilePath = resolvePath(postcompile);
  if (!postcompilePath || !existsSync(postcompilePath)) {
    console.error(`  [kern:compile postcompile script not found: ${postcompile}]`);
    process.exit(1);
  }
  runCommand('/bin/bash', [postcompilePath], `postcompile (${postcompilePath})`);
}
