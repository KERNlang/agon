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
// KNOWN LIMITATIONS (deliberate — conservative bias toward false-NEGATIVES so a
// passing build is never blocked by a phantom): `export * from` is not analyzed
// (needs cross-module resolution); only CALL sites (`name(` / `name?.(`) are
// flagged, not bare value reads (`const x = foo`) — calls are the guaranteed
// crash and keep precision high. Method CALLS (`obj.name()`) are excluded via a
// `.` lookbehind, but an object/class method-shorthand DEFINITION (`{ name() {} }`)
// whose name collides with a re-exported-from value with no local binding could
// false-positive; none exist in the real tree today (the full scan is green) —
// if one appears, give it a local import or rename, don't loosen the guard.
//
// Exit 1 with a report if any are found; exit 0 clean.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// fileURLToPath (not new URL().pathname) — pathname keeps %20 etc. on paths
// with spaces, which made walk() ENOENT-swallow and the guard exit green
// WITHOUT scanning. It also fixes the Windows /C:/ leading-slash case.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Every workspace that kern:compile:workspaces builds AND emits generated output.
// Keep in sync with package.json kern:compile:workspaces (mcp/saas-api were the
// omitted ones); dedup also emits generated code. A missing dir is skipped, but
// each listed dir MUST resolve — see the existence assertion in check().
const GENERATED_DIRS = [
  'packages/core/src/generated',
  'packages/cli/src/generated',
  'packages/forge/src/generated',
  'packages/adapter-cli/src/generated',
  'packages/mcp/src/generated',
  'packages/saas-api/src/generated',
  'packages/dedup/src/generated',
];

function walk(dir) {
  const out = [];
  let entries;
  // withFileTypes: one syscall per entry instead of readdir + stat, and no
  // statSync throw on a broken symlink (Dirent.isDirectory needs no stat).
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      // Resolve the link target; skip it entirely if dangling.
      try { isDir = statSync(full).isDirectory(); } catch { continue; }
    }
    if (isDir) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

// Strip line/block comments and string/template literals so identifiers that
// only appear in comments or strings don't count as "used". Single-pass over a
// combined alternation so a `//` inside a string (or a `'` inside a comment)
// can't desync the stripper the way sequential passes did. Conservative: only
// ever REMOVES text, so it can miss a use, never invent one.
function stripCommentsAndStrings(src) {
  return src.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g,
    (match) => {
      if (match.startsWith('/*') || match.startsWith('//')) return ' ';
      if (match[0] === '`') return '``';
      if (match[0] === "'") return "''";
      return '""';
    },
  );
}

// Parse one `{ a, b as c, type T }` clause into BOTH the local-visible name and
// the source name, skipping `type`-only specifiers (type space has no runtime
// binding). Returns { locals, sources }:
//   - locals:  the name visible in THIS module (`c` for `b as c`, else `a`) —
//              used to decide whether an import gives a local binding.
//   - sources: the ORIGINAL name (`b` for `b as c`) — for a re-export the
//              crash-prone local call uses the source name, not the alias.
function parseClause(clause) {
  const locals = [];
  const sources = [];
  for (let spec of clause.split(',')) {
    spec = spec.trim();
    if (!spec) continue;
    if (/^type\s/.test(spec) || spec === 'type') continue; // type-only specifier
    const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(spec);
    if (asMatch) {
      sources.push(asMatch[1]);
      locals.push(asMatch[2]);
    } else if (/^[A-Za-z_$][\w$]*$/.test(spec)) {
      sources.push(spec);
      locals.push(spec);
    }
  }
  return { locals, sources };
}

function check() {
  const findings = [];
  for (const rel of GENERATED_DIRS) {
    const abs = path.join(ROOT, rel);
    for (const file of walk(abs)) {
      const raw = readFileSync(file, 'utf8');

      // 1) Re-exported-from VALUE names. Track the SOURCE name (pre-`as`) — that
      //    is what a local call would reference. Skip `export type { ... } from`.
      const reexported = new Set();
      const reExpRe = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
      let m;
      while ((m = reExpRe.exec(raw)) !== null) {
        if (m[1]) continue; // `export type { ... } from` — type-space, no runtime
        for (const name of parseClause(m[2]).sources) reexported.add(name);
      }
      if (reexported.size === 0) continue;

      // 2) Local bindings: value imports + top-level declarations. For imports
      //    the LOCAL name is the binding (alias if present).
      const local = new Set();
      const impNamedRe = /import\s+(type\s+)?\{([^}]*)\}\s*from/g;
      while ((m = impNamedRe.exec(raw)) !== null) {
        if (m[1]) continue; // `import type { ... }` — no runtime binding
        for (const name of parseClause(m[2]).locals) local.add(name);
      }
      // import def from '...'  /  import def, { ... } from   (skip `import type X`)
      const impDefRe = /import\s+(?!type\s)([A-Za-z_$][\w$]*)\s*(?:,|from)/g;
      while ((m = impDefRe.exec(raw)) !== null) local.add(m[1]);
      const impNsRe = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g;
      while ((m = impNsRe.exec(raw)) !== null) local.add(m[1]);
      // top-level declarations (line-anchored: [ \t]* not \s*, so a nested decl
      // inside a function body is NOT mistaken for a module-scope binding).
      const declRe = /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/g;
      while ((m = declRe.exec(raw)) !== null) local.add(m[1]);

      // 3) For each re-exported-only name, flag a CALL to it in the body.
      //    Match `name(` and `name?.(` but NOT `obj.name(` (negative lookbehind
      //    for `.` — a method call on another object is not a ReferenceError).
      const body = stripCommentsAndStrings(raw);
      for (const name of reexported) {
        if (local.has(name)) continue; // genuinely bound (import + export-from) → safe
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const callRe = new RegExp(`(?<![.\\w$])${esc}\\s*(?:\\?\\.\\s*)?\\(`);
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
