#!/usr/bin/env node
// Usage: node scripts/release/prepare.mjs <version|vX.Y.Z> [--skip-build]
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './release-plan.mjs';

const argv = process.argv.slice(2);
const version = argv.find((arg) => !arg.startsWith('--'));
if (!version) throw new Error('usage: prepare.mjs <version|vX.Y.Z> [--skip-build]');

const run = (command, args) => execFileSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });

run(process.execPath, ['scripts/release/set-version.mjs', version]);
run(process.execPath, ['scripts/spec/generate-modular-surface-catalog.mjs']);
run('npm',['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
if (!argv.includes('--skip-build')) run('npm', ['run', 'build:cli']);
// Order matters: the channel pins tarball hashes of built output, and the SBOM reads the channel.
run(process.execPath, ['scripts/spec/verify-modular-release-set.mjs']);
run(process.execPath, ['scripts/spec/verify-modular-supply-chain.mjs']);
