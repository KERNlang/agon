#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REQUIRED_MAJOR = 22;

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), '..');

function majorOf(version) {
  const match = String(version ?? '').trim().match(/^v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

function readPinnedNodeVersion() {
  for (const file of ['.nvmrc', '.node-version']) {
    const full = join(repoRoot, file);
    if (!existsSync(full)) continue;
    const raw = readFileSync(full, 'utf8').trim();
    if (raw) return raw.replace(/^v/, '');
  }
  return '22.22.0';
}

function nodeVersionFor(binary) {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

function candidateNodeBins(pinned) {
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };

  add(process.env.AGON_NODE22);
  add(process.env.AGON_NODE);

  const nvmDirs = [
    process.env.NVM_DIR,
    join(homedir(), '.nvm'),
  ].filter(Boolean);
  for (const nvmDir of nvmDirs) {
    add(join(nvmDir, 'versions', 'node', `v${pinned}`, 'bin', 'node'));
  }

  if (process.env.VOLTA_HOME) add(join(process.env.VOLTA_HOME, 'bin', 'node'));

  return candidates;
}

function findNode22() {
  const pinned = readPinnedNodeVersion();
  for (const candidate of candidateNodeBins(pinned)) {
    if (!existsSync(candidate)) continue;
    const version = nodeVersionFor(candidate);
    if (majorOf(version) >= REQUIRED_MAJOR) return candidate;
  }
  return null;
}

function run(cmd, args, env = process.env) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
  });
  if (result.error) {
    console.error(`[agon:node22] failed to launch ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

const command = process.argv[2];
const commandArgs = process.argv.slice(3);

if (!command) {
  console.error('Usage: node scripts/run-node22.mjs <command> [...args]');
  process.exit(1);
}

if (majorOf(process.version) < REQUIRED_MAJOR) {
  const node22 = findNode22();
  if (!node22) {
    console.error(`[agon:node22] Node ${REQUIRED_MAJOR}+ is required, current is ${process.version}.`);
    console.error('[agon:node22] Run `nvm use` in this repo, or set AGON_NODE22=/path/to/node22.');
    process.exit(1);
  }

  run(node22, [scriptPath, command, ...commandArgs], {
    ...process.env,
    PATH: `${dirname(node22)}:${process.env.PATH ?? ''}`,
  });
}

run(command, commandArgs, process.env);
