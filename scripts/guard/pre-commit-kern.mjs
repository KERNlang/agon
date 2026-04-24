#!/usr/bin/env node
/**
 * Pre-commit hook: compile .kern files without npm to avoid .git/index.lock races.
 * Calls run-kern-compile.mjs directly per workspace.
 */
import { spawnSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

// Check if any .kern files are staged (including renames and deletes)
let stagedKern;
try {
  stagedKern = execSync('git diff --cached --name-only --diff-filter=ACMRD -- "*.kern"', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
} catch (err) {
  const stderr = err.stderr?.toString?.() ?? '';
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

// Run each workspace compile directly via node (no npm → no index.lock contention)
const workspaces = [
  { name: 'core',    extra: '--postcompile=scripts/kern-postcompile.sh' },
  { name: 'forge',   extra: '' },
  { name: 'adapter-cli', extra: '' },
  { name: 'cli',     extra: '' },
  { name: 'mcp',     extra: '' },
];

for (const ws of workspaces) {
  const wsDir = path.join(repoRoot, 'packages', ws.name);
  const args = [
    '../../scripts/run-kern-compile.mjs',
    'src/kern/',
    'src/generated/',
    '--target=auto',
    '--recursive',
  ];
  if (ws.extra) args.push(ws.extra);

  const result = spawnSync('node', args, {
    cwd: wsDir,
    stdio: 'inherit',
    env: { ...process.env, KERN_SKIP_LOCAL_SYNC: '1' },
  });

  if (result.status !== 0) {
    console.error(`[kern-guard] kern:compile failed in packages/${ws.name}. Commit aborted.`);
    process.exit(1);
  }
}

// Auto-stage generated files that changed during compile
const generatedDiff = spawnSync('git', ['diff', '--name-only'], {
  cwd: repoRoot,
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
      cwd: repoRoot,
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
