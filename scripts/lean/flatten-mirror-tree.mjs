#!/usr/bin/env node
/**
 * Phase B of the lean-up: flatten the codegen-era mirror tree into each
 * package's `src/` root and drop the pure re-export facades that pointed at it.
 *
 * Post-eject the mirror was ordinary hand-maintained source, so its name was a
 * lie and the facade layer in front of it was pure indirection. Kept in-repo as
 * the record of how the move was made; it is a one-shot tool and only runs
 * against a tree that still has the mirror.
 *
 * Subcommands:
 *   inventory   classify facades (PURE vs VALUE-ADD), list moves + collisions
 *   plan <out>  snapshot the pre-move layout + move map as JSON
 *   pure-list   the facades safe to delete
 *   move-list   old path -> new path, one per line
 *   rewrite <plan> [--apply]
 *               replay the plan over the moved tree, repointing every module
 *               reference (static, dynamic, vi.mock, plain path strings, …)
 *
 * The script is intentionally dependency-free apart from `typescript`, which is
 * already a devDependency, so it can be re-run from a clean checkout.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const SRC_EXTS = ['.ts', '.tsx'];
// The one place the retired directory is named. It is an input to this
// tool, not vocabulary the codebase uses any more.
const MIRROR_DIR = 'generated';
const MIRROR_SEG = `${path.sep}${MIRROR_DIR}${path.sep}`;
const MIRROR_SRC_SEG = `${path.sep}src${MIRROR_SEG}`;

/** Recursively list files under `dir`, skipping node_modules/dist. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function packages() {
  const dir = path.join(ROOT, 'packages');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'src')))
    .map((e) => path.join(dir, e.name));
}

/** Every file living under the mirror tree. */
export function mirrorFiles() {
  const out = [];
  for (const pkg of packages()) {
    const gen = path.join(pkg, 'src', MIRROR_DIR);
    if (!fs.existsSync(gen)) continue;
    for (const file of walk(gen)) out.push(file);
  }
  return out.sort();
}

/**
 * Two mirror modules would land on a path already taken by a value-add facade
 * that has to survive (`forge/src/types.ts` adds ForgeEventCallback,
 * `forge/src/stages.ts` adds the determineWinner default). Both are kept, and
 * the module that moves takes an `-impl` name: public module in front, its
 * implementation body behind it.
 */
const COLLISION_OVERRIDES = new Map([
  ['packages/forge/src/types.ts', 'packages/forge/src/types-impl.ts'],
  ['packages/forge/src/stages.ts', 'packages/forge/src/stages-impl.ts'],
]);

/** <mirror>/a/b.ts  ->  src/a/b.ts */
export function targetOf(file) {
  const naive = file.replace(MIRROR_SRC_SEG, `${path.sep}src${path.sep}`);
  const rel = path.relative(ROOT, naive).split(path.sep).join('/');
  const override = COLLISION_OVERRIDES.get(rel);
  return override ? path.join(ROOT, override) : naive;
}

function parse(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Resolve an ESM specifier (`./foo.js`, `../<mirror>/bar/index.js`) written in
 * `fromFile` to an on-disk source path, or null when it is a bare/package
 * specifier or points outside the repo.
 */
function resolveSpecifier(fromFile, spec, exists = null) {
  if (!spec.startsWith('.')) return null;
  const has = exists ? (f) => exists.has(f) : (f) => fs.existsSync(f) && fs.statSync(f).isFile();
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [];
  if (base.endsWith('.js')) {
    const stem = base.slice(0, -3);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`);
  } else if (base.endsWith('.jsx')) {
    candidates.push(`${base.slice(0, -4)}.tsx`);
  }
  candidates.push(base, `${base}.ts`, `${base}.tsx`);
  for (const ext of SRC_EXTS) candidates.push(path.join(base, `index${ext}`));
  for (const c of candidates) {
    if (has(c)) return c;
  }
  return null;
}

/**
 * Classify a source file outside the mirror that references into it.
 *
 * PURE      -> every top-level statement re-exports from ONE legacy module and
 *              nothing else: pure indirection, safe to delete because every
 *              importer can be pointed straight at the module that moved.
 * BARREL    -> only re-exports, but aggregating SEVERAL modules (e.g. core's
 *              `tools.ts` fronts 18 tool modules). That is a real module
 *              grouping, not indirection: kept, specifiers rewritten.
 * VALUE-ADD -> adds types, aliases or logic on top. Package entrypoints
 *              (`src/index.ts`) are the public API surface and are always kept.
 */
export function classifyFacade(file) {
  const sf = parse(file);
  const targets = new Set();
  let pure = true;
  const reasons = [];
  const isEntry = /(^|[\\/])src[\\/]index\.tsx?$/.test(file);
  if (isEntry) {
    pure = false;
    reasons.push('package entrypoint (public API barrel)');
  }
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      const spec = stmt.moduleSpecifier.text;
      const resolved = resolveSpecifier(file, spec);
      if (resolved && resolved.includes(MIRROR_SEG)) {
        targets.add(resolved);
        continue;
      }
      pure = false;
      reasons.push(`re-export from a module outside the mirror: ${spec}`);
      continue;
    }
    pure = false;
    reasons.push(`top-level ${ts.SyntaxKind[stmt.kind]}`);
  }
  if (sf.statements.length === 0) {
    pure = false;
    reasons.push('empty module');
  }
  const list = [...targets];
  let category = 'value-add';
  if (pure && list.length === 1) category = 'pure';
  else if (pure && list.length > 1) {
    category = 'barrel';
    pure = false;
    reasons.push(`aggregation barrel over ${list.length} modules`);
  }
  return { file, pure, category, targets: list, reasons: [...new Set(reasons)] };
}

/** Package source files that live outside the mirror tree. */
function nonGeneratedSources() {
  const out = [];
  for (const pkg of packages()) {
    for (const file of walk(path.join(pkg, 'src'))) {
      if (file.includes(MIRROR_SRC_SEG)) continue;
      if (!SRC_EXTS.includes(path.extname(file))) continue;
      out.push(file);
    }
  }
  return out.sort();
}

export function inventory() {
  const gen = mirrorFiles();
  const facades = [];
  for (const file of nonGeneratedSources()) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(`/${MIRROR_DIR}/`)) continue;
    facades.push(classifyFacade(file));
  }
  const pureFacades = facades.filter((f) => f.category === 'pure');
  const barrels = facades.filter((f) => f.category === 'barrel');
  const valueAdd = facades.filter((f) => f.category === 'value-add');
  const deleted = new Set(pureFacades.map((f) => f.file));

  const moves = gen.map((file) => ({ from: file, to: targetOf(file) }));
  const collisions = moves
    .filter((m) => fs.existsSync(m.to) && !deleted.has(m.to))
    .map((m) => ({ ...m, existing: m.to }));

  // A pure facade whose freed path is not the mirror path of the module it
  // re-exports still needs its importers redirected.
  const redirects = [];
  for (const f of pureFacades) {
    for (const t of f.targets) {
      const mirrored = targetOf(t);
      if (mirrored !== f.file) redirects.push({ facade: f.file, module: t, newPath: mirrored });
    }
  }
  return { gen, facades, pureFacades, barrels, valueAdd, moves, collisions, redirects, deleted };
}

/**
 * A *plan* is captured BEFORE anything moves and replayed afterwards. It holds
 *   moves   old absolute path -> new absolute path (mirror modules + the pure
 *           facades that get deleted, which redirect to wherever their single
 *           module landed)
 *   files   every repo file as it looked pre-move; the reference rewriter
 *           resolves relative specifiers against this snapshot, because by the
 *           time it runs the real tree has already been rearranged.
 */
export function buildPlan() {
  const inv = inventory();
  const moves = {};
  for (const m of inv.moves) moves[rel(m.from)] = rel(m.to);
  for (const f of inv.pureFacades) moves[rel(f.file)] = rel(targetOf(f.targets[0]));
  const files = [];
  for (const pkg of packages()) files.push(...walk(path.join(pkg, 'src')));
  for (const dir of ['tests', 'scripts', '.github', 'docs']) files.push(...walk(path.join(ROOT, dir)));
  for (const name of fs.readdirSync(ROOT)) {
    const full = path.join(ROOT, name);
    if (fs.statSync(full).isFile()) files.push(full);
  }
  return { moves, files: [...new Set(files)].map(rel).sort() };
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function relSpecifier(fromFile, toFile) {
  let spec = path.relative(path.dirname(fromFile), toFile);
  if (!spec.startsWith('.')) spec = `./${spec}`;
  spec = spec.split(path.sep).join('/');
  // ESM specifiers name the emitted file: .ts/.tsx -> .js
  return spec.replace(/\.tsx?$/, '.js');
}

/**
 * Collect every string literal in a TS/TSX file that names a module:
 *  - static import/export declarations and `import type X from '…'`
 *  - `import(...)` and `require(...)`
 *  - vi.mock / vi.doMock / vi.unmock / vi.importActual / vi.importMock
 *  - jest.mock / jest.doMock / jest.requireActual
 *
 * The mock literals matter as much as the static ones: an orphaned
 * `vi.mock()` whose path no longer resolves is silently ignored by vitest, so
 * the suite would
 * quietly start exercising the real module.
 */
function moduleLiterals(sf) {
  const hits = [];
  const MOCKS = new Set([
    'mock', 'doMock', 'unmock',
    'importActual', 'importMock', 'requireActual', 'requireMock',
  ]);
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) {
      hits.push({ node: node.moduleSpecifier, kind: 'static' });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteral(node.argument.literal)) {
      hits.push({ node: node.argument.literal, kind: 'import-type' });
    } else if (ts.isCallExpression(node)) {
      const arg0 = node.arguments[0];
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require');
      const isMock = ts.isPropertyAccessExpression(node.expression)
        && MOCKS.has(node.expression.name.text)
        && ts.isIdentifier(node.expression.expression)
        && (node.expression.expression.text === 'vi' || node.expression.expression.text === 'jest');
      if ((isDynamic || isMock) && arg0 && ts.isStringLiteral(arg0)) {
        hits.push({ node: arg0, kind: isMock ? 'mock' : 'dynamic' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const REWRITABLE_EXTS = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js', '.cjs', '.json', '.yml', '.yaml', '.md', '.sh']);

/** Replay a plan over the moved tree, repointing every reference. */
export function rewrite(plan, { apply = false } = {}) {
  const move = new Map(Object.entries(plan.moves).map(([a, b]) => [path.join(ROOT, a), path.join(ROOT, b)]));
  // new path -> where that file's CONTENT lived before, so relative specifiers
  // still resolve. A deleted facade often shares its target path with the
  // module that replaced it (handlers/forge.ts fronted the mirror's
  // handlers/forge.ts); the module wins, because the facade's body is gone.
  const back = new Map();
  for (const [from, to] of move) {
    if (from === to) continue;
    const held = back.get(to);
    if (held && held.includes(MIRROR_SEG)) continue;
    back.set(to, from);
  }
  const oldFiles = new Set(plan.files.map((f) => path.join(ROOT, f)));
  // Plain-text path strings (configs, workflows, docs, shell) name the tree by
  // its repo-relative path, so build a longest-first literal replacement table.
  const literals = [...move]
    .map(([from, to]) => [rel(from), rel(to)])
    .filter(([from]) => from.includes(`/src/${MIRROR_DIR}/`))
    .sort((a, b) => b[0].length - a[0].length);

  const stats = { files: 0, static: 0, dynamic: 0, mock: 0, 'import-type': 0, text: 0 };
  const changed = [];

  for (const file of walkRepo()) {
    if (!REWRITABLE_EXTS.has(path.extname(file))) continue;
    const self = back.get(file) ?? file; // where this file lived pre-move
    let text = fs.readFileSync(file, 'utf8');
    const before = text;

    if (SRC_EXTS.includes(path.extname(file))) {
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const edits = [];
      for (const hit of moduleLiterals(sf)) {
        const target = resolveSpecifier(self, hit.node.text, oldFiles);
        if (!target) continue;
        const next = relSpecifier(file, move.get(target) ?? target);
        if (next === hit.node.text) continue;
        edits.push({ start: hit.node.getStart(sf) + 1, end: hit.node.getEnd() - 1, text: next });
        stats[hit.kind] += 1;
      }
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
      }
    }

    for (const [from, to] of literals) {
      if (!text.includes(from)) continue;
      stats.text += text.split(from).length - 1;
      text = text.split(from).join(to);
    }
    // Directory-level mentions left over after the per-file pass.
    const dirRe = new RegExp(`(packages/[a-z0-9-]+/)src/${MIRROR_DIR}/`, 'g');
    const dirs = text.replace(dirRe, '$1src/');
    if (dirs !== text) {
      stats.text += (text.match(dirRe) || []).length;
      text = dirs;
    }

    if (text !== before) {
      stats.files += 1;
      changed.push(rel(file));
      if (apply) fs.writeFileSync(file, text);
    }
  }
  return { stats, changed };
}

function walkRepo() {
  const out = [];
  for (const pkg of packages()) out.push(...walk(path.join(pkg, 'src')));
  for (const dir of ['tests', 'scripts', '.github', 'docs']) out.push(...walk(path.join(ROOT, dir)));
  for (const name of fs.readdirSync(ROOT)) {
    const full = path.join(ROOT, name);
    if (fs.statSync(full).isFile()) out.push(full);
  }
  return [...new Set(out)].sort();
}

// ---------------------------------------------------------------------------

const cmd = process.argv[2] ?? 'inventory';
if (cmd === 'inventory') {
  const inv = inventory();
  console.log(`mirror files to move:  ${inv.gen.length}`);
  console.log(`facades over that tree: ${inv.facades.length}`);
  console.log(`  PURE (delete):       ${inv.pureFacades.length}`);
  console.log(`  BARREL (keep):       ${inv.barrels.length}`);
  console.log(`  VALUE-ADD (keep):    ${inv.valueAdd.length}`);
  console.log(`collisions:            ${inv.collisions.length}`);
  console.log(`non-mirrored redirects:${inv.redirects.length}`);
  if (process.argv.includes('--verbose')) {
    console.log('\n--- BARREL (kept) ---');
    for (const f of inv.barrels) {
      console.log(`  ${path.relative(ROOT, f.file)}  :: ${f.targets.length} modules`);
    }
    console.log('\n--- VALUE-ADD ---');
    for (const f of inv.valueAdd) {
      console.log(`  ${path.relative(ROOT, f.file)}  :: ${f.reasons.join('; ')}`);
    }
    console.log('\n--- COLLISIONS ---');
    for (const c of inv.collisions) console.log(`  ${path.relative(ROOT, c.from)} -> EXISTING ${path.relative(ROOT, c.to)}`);
    console.log('\n--- NON-MIRRORED REDIRECTS ---');
    for (const r of inv.redirects) {
      console.log(`  ${path.relative(ROOT, r.facade)} => ${path.relative(ROOT, r.newPath)}`);
    }
  }
} else if (cmd === 'pure-list') {
  for (const f of inventory().pureFacades) console.log(path.relative(ROOT, f.file));
} else if (cmd === 'move-list') {
  for (const m of inventory().moves) {
    console.log(`${path.relative(ROOT, m.from)}\t${path.relative(ROOT, m.to)}`);
  }
} else if (cmd === 'plan') {
  const out = process.argv[3] ?? path.join(ROOT, 'flatten-plan.json');
  const plan = buildPlan();
  fs.writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`${Object.keys(plan.moves).length} moves, ${plan.files.length} files snapshotted -> ${out}`);
} else if (cmd === 'rewrite') {
  const planPath = process.argv[3];
  if (!planPath) {
    console.error('usage: rewrite <plan.json> [--apply]');
    process.exit(1);
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const apply = process.argv.includes('--apply');
  const { stats, changed } = rewrite(plan, { apply });
  console.log(JSON.stringify(stats, null, 2));
  console.log(`${changed.length} files ${apply ? 'rewritten' : 'would change'}`);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}
