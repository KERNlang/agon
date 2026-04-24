#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { execSync } from 'node:child_process';

// Check if any .kern files are staged (including renames and deletes)
let stagedKern;
try {
  stagedKern = execSync('git diff --cached --name-only --diff-filter=ACMRD -- "*.kern"', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
} catch (err) {
  const stderr = err.stderr?.toString?.() ?? '';
  // Only fail open for the benign "not a git repo" case
  if (stderr.includes('not a git repository') || err.status === 128) {
    process.exit(0);
  }
  console.error('[kern-guard] Git command failed. Commit aborted.');
  console.error(stderr || err.message);
  process.exit(1);
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

// Auto-stage generated files that changed during compile
const generatedDiff = spawnSync('git', ['diff', '--name-only'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
});

if (generatedDiff.status === 0) {
  const changedFiles = generatedDiff.stdout?.toString?.() ?? '';
  const generatedToStage = changedFiles
    .split('\n')
    .filter((f) => f.includes('/generated/') || f.endsWith('.ts'))
    .filter(Boolean);

  if (generatedToStage.length > 0) {
    console.log(`[kern-guard] Auto-staging ${generatedToStage.length} generated file(s)...`);
    const addResult = spawnSync('git', ['add', '--', ...generatedToStage], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    if (addResult.status !== 0) {
      console.error('[kern-guard] Failed to auto-stage generated files. Commit aborted.');
      process.exit(1);
    }
  }
}

console.log('[kern-guard] kern:compile passed. Proceeding with commit.');
process.exit(0);
