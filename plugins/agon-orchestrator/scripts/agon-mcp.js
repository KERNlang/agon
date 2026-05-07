#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(pluginDir, '..', '..');
const mcpEntry = join(repoRoot, 'packages', 'mcp', 'dist', 'index.js');
const cliEntry = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');

const child = spawn(process.execPath, [mcpEntry], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    AGON_CLI_NODE_SCRIPT: process.env.AGON_CLI_NODE_SCRIPT || cliEntry,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
