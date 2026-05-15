#!/usr/bin/env node
// Integration smoke — exercises the compiled `classifyTask` from @agon/core
// to verify the regex → Python escalation chain works end-to-end.

import { classifyTask } from '/Users/nicolascukas/KERN/Agon-AI/packages/core/dist/generated/blocks/task-classifier.js';

const fixtures = [
  // Regex fast-path (no Python invoked)
  ['Add a unit test for the auth flow',                   'test',      'regex'],
  ['Refactor the engine registry',                        'refactor',  'regex'],
  ['Update the README',                                   'docs',      'regex'],

  // Python escalation cases — regex returns 'other', Python catches them
  ['Why is my redis cache evicting entries faster than expected?', 'bugfix', 'python'],
  ['Document the rationale for the migration',                     'docs',   'python'],
  ['Page allocation is stalling under load',                       'bugfix', 'python'],
  ['Trim trailing whitespace before persisting',                   'refactor', 'python'],

  // Documented limitation: regex precedence wins. "Implement Glicko-2…"
  // matches /implement/ → 'feature', even though semantically it's
  // 'algorithm'. Layered classifier intentionally lets regex shortcut
  // when it matches at all, to bound latency. The Python escalation only
  // helps when regex falls through to 'other'.
  ['Implement Glicko-2 rating updates with confidence intervals',  'feature', 'regex'],
];

let passed = 0;
let failed = 0;

for (const [text, expected, path] of fixtures) {
  const result = classifyTask(text);
  const ok = result === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${result}] expected ${expected} via ${path} — "${text}"`);
  if (ok) passed += 1; else failed += 1;
}

console.log(`\n${passed}/${fixtures.length} passed`);
if (failed > 0) process.exit(1);
