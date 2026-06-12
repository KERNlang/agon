#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCandidate, printResolution, resolveKernCli, resolvePath, runCommand } from './kern-cli-resolver.mjs';
import { addKernSourceTraces } from './kern-source-traces.mjs';

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
prepareCandidate('kern:compile', selection.candidate);

function stripTrailingWhitespaceTree(rootDir) {
  const resolvedRoot = resolvePath(rootDir);
  if (!resolvedRoot || !existsSync(resolvedRoot)) return;
  const stack = [resolvedRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let stat;
    try {
      stat = statSync(current);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      let children = [];
      try {
        children = readdirSync(current);
      } catch {
        continue;
      }
      for (const child of children) stack.push(path.join(current, child));
      continue;
    }
    if (!stat.isFile() || !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(current)) continue;
    let before;
    try {
      before = readFileSync(current, 'utf8');
    } catch {
      continue;
    }
    const after = before
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{2,}$/g, '\n');
    if (after !== before) writeFileSync(current, after);
  }
}

// Pre-compile gate: `kern check` (4.0+) — nominal type checks (override
// variance, call arity/arg types, declared-return contracts). Zero-FP by
// design, so a red check is always a real defect; it blocks the compile.
// AGON_SKIP_KERN_CHECK=1 opts out (e.g. while bisecting compiler versions).
if (process.env.AGON_SKIP_KERN_CHECK !== '1') {
  runCommand(
    'kern:check',
    selection.candidate.command,
    [...selection.candidate.commandArgs, 'check', srcDir, '--quiet'],
    selection.candidate.label,
  );
}

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

const traceResult = addKernSourceTraces(srcDir, outDir);
if (traceResult.updated > 0) {
  console.log(`  kern-source-traces: annotated ${traceResult.updated}/${traceResult.files} generated files`);
}

stripTrailingWhitespaceTree(outDir);
