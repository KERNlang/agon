import cp from 'node:child_process';
import { realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

// Test-only effect guard, not a security sandbox. Only the known Node fixture
// may be spawned; provider commands, shells, browsers and network fetch are blocked.
const fixture = fileURLToPath(new URL('./brainstorm-engine.mjs', import.meta.url));
const spawn = cp.spawn;
const block = () => { throw new Error('PACKED_BRAINSTORM_EFFECT_BLOCKED'); };
cp.spawn = function (command, args, options) {
  if (typeof command === 'string' && Array.isArray(args) && args[0] === fixture && !options?.shell) {
    try {
      if (realpathSync(command) === realpathSync(process.execPath)) return spawn.call(this, command, args, options);
    } catch { /* Refuse unresolvable commands. */ }
  }
  return block();
};
for (const name of ['spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = block;
syncBuiltinESMExports();
globalThis.fetch = input => {
  // Ink/Yoga fetches its bundled layout WASM through an inline data URL.
  // Decode locally: never delegate even this allowed case to network fetch.
  const prefix = 'data:application/octet-stream;base64,';
  if (typeof input === 'string' && input.length < 2_000_000 && input.startsWith(prefix + 'AGFzbQ')) {
    const encoded = input.slice(prefix.length);
    if (/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      return Promise.resolve(new Response(Buffer.from(encoded, 'base64'), { headers: { 'Content-Type': 'application/wasm' } }));
    }
  }
  return block();
};

// Negative control: emulate the old buffered CLI. The engine's handshake must
// fail; otherwise the qualification does not actually discriminate streaming.
if (process.env.AGON_FIXTURE_BUFFER_STDOUT === '1') {
  const write = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk, encoding, callback) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
    const done = typeof encoding === 'function' ? encoding : callback;
    if (done) queueMicrotask(done);
    return true;
  };
  process.once('exit', () => { for (const chunk of chunks) write(chunk); });
}
