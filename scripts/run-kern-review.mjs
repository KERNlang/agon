#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCandidate, printResolution, resolveKernCli, runCommand } from './kern-cli-resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const selection = resolveKernCli(repoRoot);
printResolution('kern:review', selection, selection.requiredVersion);
prepareCandidate('kern:review', selection.candidate);
runCommand(
  'kern:review',
  selection.candidate.command,
  [...selection.candidate.commandArgs, 'review', ...process.argv.slice(2)],
  selection.candidate.label,
);
