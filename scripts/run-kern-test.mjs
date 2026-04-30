#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCandidate, printResolution, resolveKernCli, runCommand } from './kern-cli-resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const rawArgs = process.argv.slice(2);
const args = rawArgs.length > 0
  ? rawArgs
  : ['packages', '--pass-with-no-tests', '--format', 'compact'];

const selection = resolveKernCli(repoRoot);
printResolution('kern:test', selection, selection.requiredVersion);
prepareCandidate('kern:test', selection.candidate);
runCommand(
  'kern:test',
  selection.candidate.command,
  [...selection.candidate.commandArgs, 'test', ...args],
  selection.candidate.label,
);
