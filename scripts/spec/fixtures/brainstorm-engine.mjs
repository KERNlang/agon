import { appendFileSync, existsSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

// No model: deterministic protocol participant for installed CLI qualification.
const [gate, log, mode, prompt] = process.argv.slice(2);
if (!gate || !log || !prompt) throw new Error('Incomplete fixture invocation');
if (!prompt.includes('Installed fixture question')) throw new Error('Question lost before engine dispatch');
const phase = prompt.includes('## Response Format') ? 'draft' : 'expansion';
appendFileSync(log, `${phase}\n`);
// The parent releases this only after observing the run path on stdout.
// A regression to buffered output therefore cannot pass this test.
for (let attempt = 0; !existsSync(gate); attempt++) {
  if (attempt >= 100) {
    process.stderr.write('Run path was not streamed before dispatch\n');
    process.exit(2);
  }
  await setTimeout(20);
}
if (mode === 'failure' || prompt.includes('FAIL_UI_FIXTURE')) process.exit(1);
console.log(phase === 'draft' ? `draft {
  approach: "Exercise the installed command with deterministic local engines"
  reasoning: "The real parser, dispatch and persistence remain under test"
  confidence: 80
  tradeoffs: "Does not qualify live providers"
  steps { 1: "Run fixture" 2: "Inspect persisted result" }
}` : 'PACKED_BRAINSTORM_EXPANSION');
