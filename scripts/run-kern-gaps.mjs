#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCandidate, printResolution, resolveKernCli, runCommand } from './kern-cli-resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const rawArgs = process.argv.slice(2);
const args = rawArgs.some((arg) => arg.startsWith('--root='))
  ? rawArgs
  : [`--root=${repoRoot}`, ...rawArgs];

const selection = resolveKernCli(repoRoot);
printResolution('kern:gaps', selection, selection.requiredVersion);
prepareCandidate('kern:gaps', selection.candidate);
runCommand(
  'kern:gaps',
  selection.candidate.command,
  [...selection.candidate.commandArgs, 'gaps', ...args],
  selection.candidate.label,
);
