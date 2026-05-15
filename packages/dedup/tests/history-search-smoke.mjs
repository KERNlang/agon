#!/usr/bin/env node
// Smoke test for the history-search sidecar — feeds a small fixture and
// asserts the right item ranks first.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecar = join(__dirname, '..', 'history-search.py');

const payload = {
  query: 'add Python sidecar for brainstorm dedup',
  items: [
    { id: 'run-a', text: 'Fix typo in README' },
    { id: 'run-b', text: 'Cluster paraphrased engine drafts via fastembed sidecar' },
    { id: 'run-c', text: 'Update glicko ratings table' },
    { id: 'run-d', text: 'Bump tsup version' },
  ],
  top_k: 3,
};

const proc = spawn('python3', [sidecar], { stdio: ['pipe', 'pipe', 'inherit'] });
proc.stdin.write(JSON.stringify(payload));
proc.stdin.end();

let out = '';
proc.stdout.on('data', (chunk) => { out += chunk.toString(); });
proc.on('close', (code) => {
  if (code !== 0) {
    console.error(`sidecar exited ${code}`);
    process.exit(code ?? 1);
  }
  let parsed;
  try { parsed = JSON.parse(out); } catch (err) {
    console.error('sidecar output not valid JSON:', out);
    process.exit(1);
  }
  console.log('sidecar output:', JSON.stringify(parsed, null, 2));

  if (!Array.isArray(parsed.results) || parsed.results.length === 0) {
    console.error('FAIL: expected at least one result');
    process.exit(1);
  }
  if (parsed.results[0].id !== 'run-b') {
    console.error(`FAIL: expected run-b first (the Python sidecar one), got ${parsed.results[0].id}`);
    process.exit(1);
  }
  if (parsed.results.length > payload.top_k) {
    console.error(`FAIL: returned ${parsed.results.length} > top_k ${payload.top_k}`);
    process.exit(1);
  }
  console.log('PASS: history-search ranks the semantically-relevant item first');
});
