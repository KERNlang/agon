import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

// Diagnostic preload for the packed MCP subprocess. No provider/auth/browser
// child process or fetch may escape this fixture. Do not use in production.
const block = () => {
  process.stderr.write('PACKED_MCP_EFFECT_BLOCKED\n');
  throw new Error('PACKED_MCP_EFFECT_BLOCKED');
};
const spawn = cp.spawn;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = block;
// Permit only the installed read-only fixture client. Its child cannot spawn.
cp.spawn = (command, args, options) => {
  const cli = process.env.AGON_PACKED_JOB_CLI;
  if (!cli || command !== process.execPath || options?.shell
    || JSON.stringify(args) !== JSON.stringify([cli, 'job', 'status', 'absent-fixture', '--json'])) return block();
  const env = { ...process.env, ...options?.env };
  delete env.AGON_PACKED_JOB_CLI;
  return spawn(command, ['--import', import.meta.filename, ...args], { ...options, env });
};
syncBuiltinESMExports();
globalThis.fetch = block;
