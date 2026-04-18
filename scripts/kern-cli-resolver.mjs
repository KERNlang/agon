import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function normalizeRequirement(range) {
  if (!range) return null;
  const match = range.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

export function parseVersion(value) {
  if (!value) return null;
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

export function resolvePath(input, baseDir = process.cwd()) {
  if (!input) return null;
  return path.isAbsolute(input) ? input : path.resolve(baseDir, input);
}

export function resolveOverridePath(input, repoRoot) {
  if (!input) return null;
  if (path.isAbsolute(input)) return input;

  const fromRepoRoot = path.resolve(repoRoot, input);
  if (existsSync(fromRepoRoot)) {
    return fromRepoRoot;
  }

  return path.resolve(process.cwd(), input);
}

export function readPackageVersion(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const pkg = readJson(filePath);
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export function inspectCommandVersion(command, args = []) {
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

export function findPackageRoot(startPath) {
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

export function readEffectiveKernVersion(cliPackageRoot) {
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

export function describeCandidate(label, command, commandArgs, packageVersion, effectiveVersion = null, allowStale = false) {
  return {
    label,
    command,
    commandArgs,
    packageVersion,
    effectiveVersion,
    allowStale,
  };
}

export function withPrepare(candidate, prepare) {
  return {
    ...candidate,
    prepare,
  };
}

export function isNodeEntrypoint(filePath) {
  return /\.(c|m)?js$/i.test(filePath);
}

export function collectCandidates(repoRoot) {
  const rootPackageJson = readJson(path.join(repoRoot, 'package.json'));
  const requiredVersion = normalizeRequirement(rootPackageJson.optionalDependencies?.['@kernlang/cli']);
  const envBin = process.env.KERN_BIN?.trim();
  const envPath = resolveOverridePath(envBin, repoRoot);
  const envRepo = process.env.KERN_REPO?.trim();
  const installedCli = path.join(repoRoot, 'node_modules/.bin/kern');
  const installedPkg = path.join(repoRoot, 'node_modules/@kernlang/cli/package.json');

  const candidates = [];

  const makePrepare = (kernRepo) => ({
    label: `local kern-lang build (${kernRepo})`,
    command: 'pnpm',
    args: ['-C', kernRepo, 'exec', 'tsc', '-b', 'packages/cli'],
  });

  if (envBin) {
    if (envPath && existsSync(envPath)) {
      const envIsNodeEntrypoint = isNodeEntrypoint(envPath);
      const cliPackageRoot = findPackageRoot(envPath);
      const baseCandidate = describeCandidate(
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
        );
      const kernRepo = cliPackageRoot ? path.resolve(cliPackageRoot, '../..') : null;
      candidates.push(
        kernRepo && existsSync(path.join(kernRepo, 'packages/cli/tsconfig.json'))
          ? withPrepare(baseCandidate, makePrepare(kernRepo))
          : baseCandidate,
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

  const localRepo = envRepo ? resolveOverridePath(envRepo, repoRoot) : null;

  if (localRepo) {
    const localCli = path.join(localRepo, 'packages/cli/dist/cli.js');
    if (existsSync(localCli)) {
      const cliPackageRoot = findPackageRoot(localCli);
      const baseCandidate = describeCandidate(
        `local kern-lang (${localCli})`,
        process.execPath,
        [localCli],
        readPackageVersion(path.join(localRepo, 'packages/cli/package.json')),
        readEffectiveKernVersion(cliPackageRoot),
        true,
      );
      candidates.push(
        withPrepare(baseCandidate, makePrepare(localRepo)),
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

  return {
    candidates,
    requiredVersion,
    localRequested: Boolean(envRepo),
    localResolved: Boolean(localRepo),
  };
}

export function selectCandidate(candidates, requiredVersion) {
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

export function resolveKernCli(repoRoot) {
  const { candidates, requiredVersion, localRequested, localResolved } = collectCandidates(repoRoot);

  if (localRequested && !localResolved) {
    console.error('  [kern] local Kern mode was requested but no local Kern checkout was found');
    console.error('  [kern] set KERN_REPO=/path/to/kern-lang');
    process.exit(1);
  }

  const selection = selectCandidate(candidates, requiredVersion);

  if (!selection.candidate) {
    console.error('  [kern] could not find a suitable Kern CLI');
    if (requiredVersion) {
      console.error(`  [kern] requires @kernlang/cli >= ${requiredVersion}`);
    }
    if (selection.rejected.length > 0) {
      console.error(`  [kern] rejected stale candidates: ${selection.rejected.join('; ')}`);
    }
    console.error('  [kern] install the pinned @kernlang/cli family or set KERN_BIN to an explicit override');
    process.exit(1);
  }

  return { requiredVersion, ...selection };
}

export function printResolution(prefix, selection, requiredVersion) {
  if (requiredVersion && !selection.candidate.allowStale && selection.version !== 'unknown') {
    const declaredVersion = selection.candidate.packageVersion;
    if (selection.candidate.effectiveVersion && declaredVersion && selection.candidate.effectiveVersion !== declaredVersion) {
      console.log(
        `  [${prefix}] resolved effective ${selection.candidate.effectiveVersion}; package declares ${declaredVersion}; required >= ${requiredVersion}`,
      );
    } else {
      console.log(`  [${prefix}] resolved ${selection.version}; required >= ${requiredVersion}`);
    }
  } else if (selection.version !== 'unknown') {
    console.log(`  [${prefix}] resolved ${selection.version}`);
  }
}

export function prepareCandidate(prefix, candidate) {
  if (!candidate?.prepare) return;
  if (process.env.KERN_SKIP_LOCAL_SYNC === '1') return;

  console.log(`  [${prefix}] syncing ${candidate.prepare.label}`);
  const result = spawnSync(candidate.prepare.command, candidate.prepare.args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`  [${prefix}] failed to sync ${candidate.prepare.label}: ${result.error.message}`);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

export function runCommand(prefix, command, args, label) {
  console.log(`  [${prefix}] using ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`  [${prefix}] failed to launch ${label}: ${result.error.message}`);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}
