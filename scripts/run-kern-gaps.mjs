#!/usr/bin/env node

import path from 'node:path';
import os from 'node:os';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareCandidate, printResolution, resolveKernCli, runCommand } from './kern-cli-resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const rawArgs = process.argv.slice(2);
const hasOption = (args, name) => args.some((arg) => arg === name || arg.startsWith(`${name}=`));

function collectPackageGapDirs(root) {
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return [];

  return readdirSync(packagesDir)
    .map((entry) => path.join(packagesDir, entry))
    .filter((entryPath) => {
      try {
        return statSync(entryPath).isDirectory();
      } catch {
        return false;
      }
    })
    .map((packageDir) => path.join(packageDir, '.kern-gaps'))
    .filter((gapDir) => existsSync(gapDir));
}

function buildMergedPackageGapDir(root) {
  const gapDirs = collectPackageGapDirs(root);
  if (gapDirs.length === 0) return null;

  const mergedDir = mkdtempSync(path.join(os.tmpdir(), 'agon-kern-gaps-'));
  let written = 0;

  for (const gapDir of gapDirs) {
    const packageName = path.basename(path.dirname(gapDir));
    for (const entry of readdirSync(gapDir)) {
      if (!entry.endsWith('.json')) continue;

      let gaps;
      try {
        gaps = JSON.parse(readFileSync(path.join(gapDir, entry), 'utf8'));
      } catch {
        continue;
      }
      if (!Array.isArray(gaps)) continue;

      const liveGaps = gaps.filter((gap) => typeof gap?.file === 'string' && existsSync(gap.file));
      if (liveGaps.length === 0) continue;

      const outFile = path.join(mergedDir, `${packageName}__${entry}`);
      writeFileSync(outFile, `${JSON.stringify(liveGaps, null, 2)}\n`);
      written++;
    }
  }

  if (written === 0) {
    rmSync(mergedDir, { recursive: true, force: true });
    return null;
  }

  return mergedDir;
}

const args = hasOption(rawArgs, '--root')
  ? rawArgs
  : [`--root=${repoRoot}`, ...rawArgs];
const mergedGapDir = hasOption(rawArgs, '--gap-dir') ? null : buildMergedPackageGapDir(repoRoot);
if (mergedGapDir) {
  args.push(`--gap-dir=${mergedGapDir}`);
}

const selection = resolveKernCli(repoRoot);
printResolution('kern:gaps', selection, selection.requiredVersion);
prepareCandidate('kern:gaps', selection.candidate);
try {
  runCommand(
    'kern:gaps',
    selection.candidate.command,
    [...selection.candidate.commandArgs, 'gaps', ...args],
    selection.candidate.label,
  );
} finally {
  if (mergedGapDir) {
    rmSync(mergedGapDir, { recursive: true, force: true });
  }
}
