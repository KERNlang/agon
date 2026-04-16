#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printResolution, resolveKernCli, resolvePath, runCommand } from './kern-cli-resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

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

const selection = resolveKernCli(repoRoot);
printResolution('kern:compile', selection, selection.requiredVersion);

runCommand(
  'kern:compile',
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
  runCommand('kern:compile', '/bin/bash', [postcompilePath], `postcompile (${postcompilePath})`);
}
