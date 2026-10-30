import cp from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(import.meta.url);
if (process.argv[1] === fixture) {
  const [log, prompt] = process.argv.slice(2);
  if (!log || !prompt) throw new Error('Incomplete Synthesis fixture');
  // CliAdapter can prepend system instructions before the user prompt.
  const phase = /^## SYNTHESIS JUDGE\r?$/m.test(prompt) ? 'judge' : 'draft';
  appendFileSync(log, `${phase}\n`);
  console.log(phase === 'judge'
    ? 'SCORE_1: 90\nWINNER: fixture-synthesis\nREASONING: fixture'
    : 'PACKED_SYNTHESIS_DRAFT');
} else {
  // Test-only effect guard. This is not a security sandbox.
  const spawn = cp.spawn;
  const block = () => { throw new Error('PACKED_SYNTHESIS_EFFECT_BLOCKED'); };
  let adviceWritten = false;
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, encoding, callback) => {
    if (String(chunk).includes('Heads up: `agon synthesis`')) {
      if (process.env.AGON_FIXTURE_HIDE_ADVICE === '1') {
        const done = typeof encoding === 'function' ? encoding : callback;
        if (done) queueMicrotask(done);
        return true;
      }
      if (process.env.AGON_FIXTURE_DELAY_ADVICE === '1') {
        setTimeout(() => write(chunk), 25);
        const done = typeof encoding === 'function' ? encoding : callback;
        if (done) queueMicrotask(done);
        return true;
      }
      adviceWritten = true;
    }
    return write(chunk, encoding, callback);
  };
  cp.spawn = function (command, args, options) {
    if (Array.isArray(args) && args[0] === fixture && !options?.shell) {
      if (process.env.AGON_FIXTURE_REQUIRE_ADVICE === '1' && !adviceWritten) {
        throw new Error('Routing warning not written before provider dispatch');
      }
      try {
        if (realpathSync(command) === realpathSync(process.execPath)) return spawn.call(this, command, args, options);
      } catch { /* Refuse unresolved commands. */ }
    }
    return block();
  };
  for (const name of ['spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = block;
  syncBuiltinESMExports();
  globalThis.fetch = block;
}
