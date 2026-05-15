#!/usr/bin/env node
// Integration test for the @agon/core bridge — exercises the path
// resolution, env-var disable switch, language detection, and JSON-field
// mapping that the per-sidecar smoke test doesn't touch.

import {
  validateSyntax,
  detectLanguageFromPath,
} from '@agon/core';

let failed = 0;
function check(name, cond) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    console.error(`FAIL: ${name}`);
    failed++;
  }
}

// detectLanguageFromPath — extension mapping
check('detect .ts', detectLanguageFromPath('foo.ts') === 'typescript');
check('detect .tsx', detectLanguageFromPath('foo.tsx') === 'tsx');
check('detect .mjs', detectLanguageFromPath('foo.mjs') === 'javascript');
check('detect .py', detectLanguageFromPath('foo.py') === 'python');
check('detect .json', detectLanguageFromPath('foo.json') === 'json');
check('detect unknown returns empty', detectLanguageFromPath('foo.zig') === '');

// validateSyntax — valid TS
const r1 = validateSyntax([
  { path: 'a.ts', content: 'const x: number = 1;\nexport { x };\n', language: 'typescript' },
]);
check('valid TS comes back valid',
  r1 !== null && r1.length === 1 && r1[0].valid === true && r1[0].errors.length === 0);

// validateSyntax — invalid TS
const r2 = validateSyntax([
  { path: 'b.ts', content: 'const x: number = ;', language: 'typescript' },
]);
check('invalid TS comes back invalid',
  r2 !== null && r2.length === 1 && r2[0].valid === false && r2[0].errors.length > 0);

// validateSyntax — Python indentation (must be caught by the ast.parse fallback,
// since tree-sitter's Python grammar is forgiving here)
const r3 = validateSyntax([
  { path: 'c.py', content: 'def hi():\nreturn 1\n', language: 'python' },
]);
check('Python indentation error caught (CPython ast supplement)',
  r3 !== null && r3.length === 1 && r3[0].valid === false && r3[0].errors.length > 0);

// validateSyntax — unsupported language flagged, not silently passed
const r4 = validateSyntax([
  { path: 'd.zig', content: 'const std = @import("std");', language: 'zig' },
]);
check('Unsupported language flagged languageUnsupported=true',
  r4 !== null && r4.length === 1 && r4[0].languageUnsupported === true);

// validateSyntax — empty list returns []
const r5 = validateSyntax([]);
check('empty input returns []', Array.isArray(r5) && r5.length === 0);

// validateSyntax — disable env returns null (sidecar not consulted)
process.env.AGON_DISABLE_SYNTAX_VALIDATOR_SIDECAR = '1';
const r6 = validateSyntax([
  { path: 'x.ts', content: 'const x = 1;', language: 'typescript' },
]);
delete process.env.AGON_DISABLE_SYNTAX_VALIDATOR_SIDECAR;
check('disable env yields null', r6 === null);

if (failed > 0) {
  console.error(`\nFAIL: ${failed} expectation(s) failed`);
  process.exit(1);
}
console.log('\nPASS: bridge integration covers detect / valid / invalid / py-indent / unsupported / empty / disable');
