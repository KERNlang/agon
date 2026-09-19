import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

// Diagnostic preload for the packed MCP subprocess. No provider/auth/browser
// child process or fetch may escape this fixture. Do not use in production.
const block = () => {
  process.stderr.write('PACKED_MCP_EFFECT_BLOCKED\n');
  throw new Error('PACKED_MCP_EFFECT_BLOCKED');
};
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = block;
syncBuiltinESMExports();
globalThis.fetch = block;
