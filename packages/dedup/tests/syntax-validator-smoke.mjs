#!/usr/bin/env node
// Smoke test for the syntax-validator sidecar — asserts valid files are
// reported valid and intentionally broken files surface the right error.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecar = join(__dirname, '..', 'syntax-validator.py');

const payload = {
  files: [
    { path: 'good.ts', content: 'const x: number = 1;\nexport { x };\n', language: 'typescript' },
    { path: 'bad.ts',  content: 'const x: number = ;', language: 'typescript' },
    { path: 'good.py', content: 'def hi():\n    return 1\n', language: 'python' },
    { path: 'bad.py',  content: 'def hi(:', language: 'python' },
    { path: 'good.tsx', content: 'export const X = () => <div>{1}</div>;\n', language: 'tsx' },
    { path: 'good.json', content: '{"a": 1}', language: 'json' },
    { path: 'bad.json',  content: '{"a": 1, "b":}', language: 'json' },
    { path: 'unknown.zig', content: 'const std = @import("std");', language: 'zig' },
  ],
};

const proc = spawn('python3', [sidecar], { stdio: ['pipe', 'pipe', 'inherit'] });
proc.stdin.write(JSON.stringify(payload));
proc.stdin.end();

// Without this handler, a missing python3 fires `error` and `close` may not,
// hanging the test indefinitely.
proc.on('error', (err) => {
  console.error(`FAIL: could not spawn python3: ${err.message}`);
  process.exit(1);
});

let out = '';
proc.stdout.on('data', (chunk) => { out += chunk.toString(); });
proc.on('close', (code) => {
  // Exit 3 is OK — it just signals 'at least one unsupported language'
  if (code !== 0 && code !== 3) {
    console.error(`sidecar exited ${code}`);
    process.exit(code ?? 1);
  }
  let parsed;
  try { parsed = JSON.parse(out); } catch (err) {
    console.error('sidecar output not valid JSON:', out);
    process.exit(1);
  }

  const byPath = Object.fromEntries(parsed.results.map((r) => [r.path, r]));

  const checks = [
    ['good.ts', (r) => r.valid === true && r.errors.length === 0],
    ['bad.ts', (r) => r.valid === false && r.errors.length > 0],
    ['good.py', (r) => r.valid === true && r.errors.length === 0],
    ['bad.py', (r) => r.valid === false && r.errors.length > 0],
    ['good.tsx', (r) => r.valid === true && r.errors.length === 0],
    ['good.json', (r) => r.valid === true && r.errors.length === 0],
    ['bad.json', (r) => r.valid === false && r.errors.length > 0],
    ['unknown.zig', (r) => r.language_unsupported === true],
  ];

  let failed = 0;
  for (const [path, check] of checks) {
    const r = byPath[path];
    if (!r) {
      console.error(`FAIL: missing result for ${path}`);
      failed++;
      continue;
    }
    if (!check(r)) {
      console.error(`FAIL: ${path} unexpected — ${JSON.stringify(r)}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`FAIL: ${failed} expectation(s) failed`);
    process.exit(1);
  }
  console.log('PASS: syntax-validator detects valid + invalid across TS/TSX/PY/JSON, flags unsupported');
});
