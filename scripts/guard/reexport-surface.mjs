#!/usr/bin/env node
// Guard: catch the re-export-without-local-binding bug class.
//
// KERN modules sometimes need to BOTH use a symbol internally AND re-export it.
// The failure mode (shipped in 88ba7aa4, crashed Cesar at runtime with
// "convertMessagesForSdk is not defined"):
//
//   export { foo } from './x.js'   // re-export surface, NO local binding
//   ...
//   const y = foo();               // <-- used locally → ReferenceError at runtime
//
// tsc ACCEPTS this (the re-export is valid), so typecheck is green while the
// bundle crashes. esbuild also accepts it. Only running the code reveals it.
//
// The correct KERN pattern when a symbol is BOTH used internally AND on the
// export surface:
//   - packages/core (tsc):     import from + export from BOTH (tsc allows it)
//   - packages/cli  (esbuild): import from ONLY (esbuild rejects import+export
//                              of the same name); add a separate `export { x }`
//                              of the local binding if it must stay on the surface.
//
// This guard scans GENERATED output (what actually runs) and flags any
// re-exported-from VALUE name that is ALSO CALLED in the same module body
// while having NO local binding (import / declaration). A call to an unbound
// name is a guaranteed runtime ReferenceError, so this is high-precision.
//
// Exit 1 with a report if any are found; exit 0 clean.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const GENERATED_DIRS = [
  'packages/core/src/generated',
  'packages/cli/src/generated',
  'packages/forge/src/generated',
  'packages/adapter-cli/src/generated',
];

function walk(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

// Strip line/block comments and string/template literals so identifiers that
// only appear in comments or strings don't count as "used". Best-effort but
// good enough for machine-generated output; conservative (it only ever REMOVES
// text, so it can miss a use, never invent one).
function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')  // line comments (avoid :// in urls)
    .replace(/`(?:\\.|[^`\\])*`/g, '``')    // template literals
    .replace(/'(?:\\.|[^'\\])*'/g, "''")    // single-quoted strings
    .replace(/"(?:\\.|[^"\\])*"/g, '""');   // double-quoted strings
}

// Parse the `{ a, b as c }` clause of an import/export into its bound names.
// For `a` → a; for `a as b` → b (the locally-visible name).
function parseClauseNames(clause) {
  return clause
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /\bas\b\s+([A-Za-z_$][\w$]*)/.exec(s);
      if (m) return m[1];
      return s.replace(/^type\s+/, '').trim();
    })
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
}

function check() {
  const findings = [];
  for (const rel of GENERATED_DIRS) {
    const abs = path.join(ROOT, rel);
    for (const file of walk(abs)) {
      const raw = readFileSync(file, 'utf8');

      // 1) Re-exported-from VALUE names (no local binding). Skip `export type`.
      const reexported = new Set();
      const reExpRe = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
      let m;
      while ((m = reExpRe.exec(raw)) !== null) {
        if (m[1]) continue; // `export type { ... } from` — type-space, no runtime
        for (const name of parseClauseNames(m[2])) reexported.add(name);
      }
      if (reexported.size === 0) continue;

      // 2) Local bindings: value imports + top-level declarations.
      const local = new Set();
      // import { a, b as c } from '...'  (skip `import type { ... }`)
      const impNamedRe = /import\s+(type\s+)?\{([^}]*)\}\s*from/g;
      while ((m = impNamedRe.exec(raw)) !== null) {
        if (m[1]) continue;
        for (const name of parseClauseNames(m[2])) local.add(name);
      }
      // import def from '...'  /  import def, { ... } from  /  import * as ns from
      const impDefRe = /import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g;
      while ((m = impDefRe.exec(raw)) !== null) local.add(m[1]);
      const impNsRe = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g;
      while ((m = impNsRe.exec(raw)) !== null) local.add(m[1]);
      // top-level declarations (with or without `export`)
      const declRe = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
      while ((m = declRe.exec(raw)) !== null) local.add(m[1]);

      // 3) For each re-exported-only name, flag a CALL to it in the body.
      const body = stripCommentsAndStrings(raw);
      for (const name of reexported) {
        if (local.has(name)) continue; // genuinely bound (import + export-from) → safe
        const callRe = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`);
        if (callRe.test(body)) {
          findings.push({ file: path.relative(ROOT, file), name });
        }
      }
    }
  }
  return findings;
}

const findings = check();
if (findings.length === 0) {
  console.log('guard:reexport — OK (no re-export-without-local-binding crashes)');
  process.exit(0);
}

console.error('\nguard:reexport — FAILED: re-exported symbol is CALLED locally but has no local binding.');
console.error('This compiles green (tsc/esbuild accept the re-export) but crashes at runtime:');
console.error('  "<name> is not defined". Fix: add an `import from` for the symbol (core), or');
console.error('  switch the .kern `export from` to `import from` and re-export the local binding (cli).\n');
for (const f of findings) {
  console.error(`  ✖ ${f.file}: re-exports + calls "${f.name}" with no local binding`);
}
console.error(`\n${findings.length} finding(s).`);
process.exit(1);
