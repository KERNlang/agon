import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const prompt = process.argv.at(-1) ?? '';
const mode = prompt.includes('AGON_LOAD_FAIL') ? 'fail'
  : prompt.includes('AGON_LOAD_CANCEL') ? 'cancel'
  : prompt.includes('AGON_LOAD_SHUTDOWN') ? 'shutdown' : 'success';
const record = phase => appendFileSync(join(process.env.AGON_HOME, 'load-engines.jsonl'),
  JSON.stringify({ phase, mode, pid: process.pid, at: Date.now() }) + '\n');
record('start');
await delay(mode === 'cancel' || mode === 'shutdown' ? 8000 : 250);
if (mode === 'fail') { record('end'); process.exit(7); }
console.log(JSON.stringify({ thoughts: [{ thoughtNumber: 1, totalThoughts: 1,
  thought: 'Local load fixture completed.', kind: 'decision', nextThoughtNeeded: false }],
summary: 'AGON_LOCAL_LOAD_OK', openQuestions: [], refinedSpec: 'Local fixture only.' }));
record('end');
