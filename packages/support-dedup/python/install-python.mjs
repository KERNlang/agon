#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const agonHome = process.env.AGON_HOME || join(homedir(), '.agon');
const venvDir = join(agonHome, 'python-sidecar');
const managedPython = process.platform === 'win32'
  ? join(venvDir, 'Scripts', 'python.exe')
  : join(venvDir, 'bin', 'python');
const requirements = join(dirname(fileURLToPath(import.meta.url)), 'requirements.txt');

mkdirSync(agonHome, { recursive: true });
if (!existsSync(managedPython)) {
  const configuredBootstrap = process.env.AGON_BOOTSTRAP_PYTHON;
  const bootstrapCommand = configuredBootstrap || (process.platform === 'win32' ? 'py' : 'python3');
  const bootstrapArgs = !configuredBootstrap && process.platform === 'win32' ? ['-3', '-m', 'venv', venvDir] : ['-m', 'venv', venvDir];
  const create = spawnSync(bootstrapCommand, bootstrapArgs, { stdio: 'inherit' });
  if (create.error) console.error(`[agon] could not start Python bootstrap ${bootstrapCommand}: ${create.error.message}`);
  if (create.status !== 0) process.exit(create.status ?? 1);
}

const install = spawnSync(managedPython, ['-m', 'pip', 'install', '-r', requirements], { stdio: 'inherit' });
if (install.error) console.error(`[agon] could not start managed Python ${managedPython}: ${install.error.message}`);
if (install.status !== 0 && !install.error) console.error('[agon] Python sidecar dependency installation failed.');
process.exit(install.status ?? 1);
