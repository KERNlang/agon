import cp from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(import.meta.url);
if (process.argv[1] === fixture) {
  const [log, prompt] = process.argv.slice(2);
  if (!log || !prompt) throw new Error('Incomplete Synthesis fixture');
  const judge = /^## SYNTHESIS JUDGE\r?$/m.test(prompt);
  appendFileSync(log, judge ? 'judge\n' : 'draft\n');
  console.log(judge ? 'SCORE_1: 90\nCONFIDENCE_1: 0.75\nWINNER: fixture-synthesis\nREASONING: fixture verdict' : 'PACKED_SYNTHESIS_DRAFT');
} else {
  // Test-only effect guard, not a security sandbox.
  const spawn = cp.spawn;
  const write = process.stdout.write.bind(process.stdout);
  const block = () => { throw new Error('PACKED_SYNTHESIS_EFFECT_BLOCKED'); };
  let announced = false;
  let heading = false;
  process.stdout.write = (chunk, encoding, callback) => {
    const text = String(chunk);
    if (text.startsWith('AGON_RUN: ') || text.startsWith(process.env.AGON_HOME + '/')) {
      if (process.env.AGON_FIXTURE_HIDE_PATH === '1') {
        const done = typeof encoding === 'function' ? encoding : callback;
        if (done) queueMicrotask(done);
        return true;
      }
      announced = true;
    }
    if (text.includes('Synthesis: Installed presentation fixture')) heading = true;
    return write(chunk, encoding, callback);
  };
  cp.spawn = function (command, args, options) {
    if (Array.isArray(args) && args[0] === fixture && !options?.shell) {
      if (!announced || (process.env.AGON_QUIET !== '1' && process.env.AGON_FIXTURE_FLAG_QUIET !== '1' && !heading)) {
        throw new Error('Synthesis presentation missing before dispatch');
      }
      if (realpathSync(command) === realpathSync(process.execPath)) return spawn.call(this, command, args, options);
    }
    return block();
  };
  for (const name of ['spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = block;
  syncBuiltinESMExports();
  globalThis.fetch = block;
}
