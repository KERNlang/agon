#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareCandidate, printResolution, resolveKernCli } from './kern-cli-resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const scriptName = process.argv[2];

if (!scriptName) {
  console.error('Usage: node scripts/run-agon-script.mjs <npm-script>');
  process.exit(1);
}

const selection = resolveKernCli(repoRoot);
printResolution(`agon:${scriptName}`, selection, selection.requiredVersion);
prepareCandidate(`agon:${scriptName}`, selection.candidate);

const result = spawnSync(
  'npm',
  ['run', scriptName],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      KERN_SKIP_LOCAL_SYNC: '1',
    },
  },
);

if (result.error) {
  console.error(`[agon:${scriptName}] failed to launch npm: ${result.error.message}`);
  process.exit(1);
}

if (typeof result.status === 'number' && result.status !== 0) {
  process.exit(result.status);
}
