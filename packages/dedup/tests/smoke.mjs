#!/usr/bin/env node
// Smoke test for the dedup sidecar — feeds a small fixture and asserts
// that two semantically-similar drafts get grouped.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecar = join(__dirname, '..', 'sidecar.py');

const fixture = [
  { id: 'claude', text: 'Pick option A — ship the FastAPI shim now as a thin layer over the existing orchestration. Lets the SaaS roadmap leapfrog the API design step.' },
  { id: 'codex',  text: 'Option A is correct. Build a minimal FastAPI wrapper around forge/brainstorm/tribunal so SaaS work can start without redesigning the API surface.' },
  { id: 'gemini', text: 'Hold off on Python entirely. Agon has no Python use case today and the maintenance burden outweighs the testbed value until SaaS is real.' },
];

const proc = spawn('python3', [sidecar], { stdio: ['pipe', 'pipe', 'inherit'] });
for (const item of fixture) proc.stdin.write(JSON.stringify(item) + '\n');
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

  const claudeCodex = parsed.groups.find((g) =>
    g.members.includes('claude') && g.members.includes('codex'));
  if (!claudeCodex) {
    console.error('FAIL: claude + codex should be grouped (they say the same thing)');
    process.exit(1);
  }
  const geminiAlone = parsed.groups.find((g) =>
    g.members.length === 1 && g.members[0] === 'gemini');
  if (!geminiAlone) {
    console.error('FAIL: gemini should be in its own group (dissents)');
    process.exit(1);
  }
  console.log('PASS: dedup sidecar groups similar drafts and isolates dissents');
});
