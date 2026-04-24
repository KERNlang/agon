#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { execSync } from 'node:child_process';

// Check if any .kern files are staged
let stagedKern;
try {
  stagedKern = execSync('git diff --cached --name-only --diff-filter=ACM -- "*.kern"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
} catch {
  process.exit(0); // no staged .kern files or not in git repo
}

if (!stagedKern.trim()) {
  process.exit(0);
}

console.log('[kern-guard] Staged .kern files detected. Running kern:compile...');

const result = spawnSync('npm', ['run', 'kern:compile'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env, KERN_SKIP_LOCAL_SYNC: '1' },
});

if (result.status !== 0) {
  console.error('[kern-guard] kern:compile failed. Commit aborted.');
  process.exit(1);
}

console.log('[kern-guard] kern:compile passed. Proceeding with commit.');
process.exit(0);
