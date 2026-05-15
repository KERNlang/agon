#!/usr/bin/env node
// Smoke test for the task classifier sidecar — feeds prompts the regex
// classifier mishandles and asserts the embedding-based one nails them.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecar = join(__dirname, '..', 'classifier.py');

// (text, expected class) — each one is a case the regex classifier
// either falls through to 'other' on, or picks wrong by keyword priority.
const fixtures = [
  ['Why is my redis cache evicting entries faster than expected?', 'bugfix'],
  ['Add tests for the auth flow',                                  'test'],
  ['Document the rationale for the migration',                    'docs'],
  ['Fix the off-by-one in pagination',                            'bugfix'],
  ['Implement Glicko-2 rating updates with confidence intervals', 'algorithm'],
  ['Rename the EngineRegistry to AdapterRegistry across the codebase', 'refactor'],
  ['Build a streaming JSON parser for the brainstorm output',     'feature'],
];

function classify(text) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [sidecar], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`exit ${code}: ${stderr.trim()}`));
      }
      try { resolve(JSON.parse(stdout)); }
      catch (err) { reject(new Error(`bad output: ${stdout}`)); }
    });
    proc.stdin.write(JSON.stringify({ text }));
    proc.stdin.end();
  });
}

let passed = 0;
let failed = 0;

for (const [text, expected] of fixtures) {
  try {
    const result = await classify(text);
    const ok = result.class === expected;
    const tag = ok ? 'PASS' : 'FAIL';
    const sortedScores = Object.entries(result.scores)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.log(`${tag} [${result.class}/${result.confidence}] expected ${expected}`);
    console.log(`     scores: ${sortedScores}`);
    console.log(`     "${text}"`);
    if (ok) passed += 1; else failed += 1;
  } catch (err) {
    console.log(`ERROR — "${text}" — ${err.message}`);
    failed += 1;
  }
}

console.log(`\n${passed}/${fixtures.length} passed`);
if (failed > 0) process.exit(1);
