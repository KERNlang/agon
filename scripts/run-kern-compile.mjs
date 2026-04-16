#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
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

function resolvePath(input) {
  if (!input) return null;
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
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

function describeCandidate(label, command, commandArgs, packageVersion, allowStale = false) {
  return {
    label,
    command,
    commandArgs,
    packageVersion,
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
  const envPath = resolvePath(envBin);
  const siblingCli = path.resolve(repoRoot, '../kern-lang/packages/cli/dist/cli.js');
  const siblingPkg = path.resolve(repoRoot, '../kern-lang/packages/cli/package.json');
  const installedCli = path.join(repoRoot, 'node_modules/.bin/kern');
  const installedPkg = path.join(repoRoot, 'node_modules/@kernlang/cli/package.json');

  const candidates = [];

  if (envBin) {
    if (envPath && existsSync(envPath)) {
      const envIsNodeEntrypoint = isNodeEntrypoint(envPath);
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
          true,
        ),
      );
    }
  }

  if (existsSync(siblingCli)) {
    candidates.push(
      describeCandidate(
        `sibling kern-lang checkout (${siblingCli})`,
        process.execPath,
        [siblingCli],
        readPackageVersion(siblingPkg),
      ),
    );
  }

  if (existsSync(installedCli)) {
    candidates.push(
      describeCandidate(
        `workspace @kernlang/cli (${installedCli})`,
        installedCli,
        [],
        readPackageVersion(installedPkg),
      ),
    );
  }

  candidates.push(
    describeCandidate(
      'PATH kern',
      'kern',
      [],
      inspectCommandVersion('kern'),
      false,
    ),
  );

  return { candidates, requiredVersion };
}

function selectCandidate(candidates, requiredVersion) {
  const requiredParts = parseVersion(requiredVersion);
  const rejected = [];

  for (const candidate of candidates) {
    const version = candidate.packageVersion;
    const parsedVersion = parseVersion(version);

    if (!candidate.allowStale && requiredParts && parsedVersion && compareVersions(parsedVersion, requiredParts) < 0) {
      rejected.push(`${candidate.label} -> ${version}`);
      continue;
    }

    if (!candidate.allowStale && requiredParts && !parsedVersion && candidate.command === 'kern') {
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
  console.error('  [kern:compile set KERN_BIN to a current kern build or install the pinned @kernlang/cli family]');
  process.exit(1);
}

if (requiredVersion && !selection.candidate.allowStale && selection.version !== 'unknown') {
  console.log(`  [kern:compile resolved ${selection.version}; required >= ${requiredVersion}]`);
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
