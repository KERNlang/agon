#!/usr/bin/env node
/**
 * Forge runner wrapper with exponential backoff retry for git-diff failures.
 * Usage: node scripts/guard/forge-retry.mjs <cmd...args>
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/guard/forge-retry.mjs <cmd> [args...]');
  process.exit(1);
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = spawnSync(args[0], args.slice(1), {
      cwd: process.cwd(),
      stdio: ['inherit', 'inherit', 'pipe'],
      env: process.env,
    });

    const stderr = result.stderr?.toString?.() ?? '';
    const isGitLockError =
      stderr.includes('index.lock') ||
      result.error?.message?.includes?.('index.lock') ||
      false;

    if (result.status === 0) {
      process.exit(0);
    }

    // Print captured stderr so user sees the actual error
    if (stderr) {
      process.stderr.write(stderr);
    }

    if (attempt < MAX_RETRIES && isGitLockError) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      console.log(`[forge-retry] Git lock detected (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${delay}ms...`);
      await sleep(delay);
      continue;
    }

    console.error(`[forge-retry] Command failed after ${attempt} attempt(s).`);
    process.exit(result.status ?? 1);
  }
}

runWithRetry();
