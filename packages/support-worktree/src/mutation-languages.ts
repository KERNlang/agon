import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { isTestFile } from './git-diff.js';
import type { LexerSyntax, QuoteSpec } from './mutation-lexer.js';
import { cLikeOperators, PYTHON_OPERATORS, RUST_OPERATORS } from './mutation-operators.js';
import type { OperatorSpec } from './mutation-operators.js';
import { shellQuote } from './shell-quote.js';

/**
 * Everything mutation testing needs to know about one language. `syntax`/`operators` are undefined only for the JS/TS profile, which keeps the original whole-line generator. `skipDirs` never hold sources; `buildDirs` are skipped only when one of `markers` (a root file name, or `*.ext`) exists, so a JS repo's own `bin/` or `target/` is still mutated. `compileCheck` returns the compile-only command for a module root (see `compileCheckFor`); a `compiled` profile without one cannot tell a compile failure from a kill.
 */
export interface LanguageProfile {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly testFile: readonly RegExp[];
  readonly syntax?: LexerSyntax;
  readonly operators?: readonly OperatorSpec[];
  readonly skipDirs: readonly string[];
  readonly buildDirs: readonly string[];
  readonly markers: readonly string[];
  readonly compiled?: boolean;
  readonly compileCheck?: (has: (file: string) => boolean) => string | undefined;
}

const q = (open: string, escape: boolean, multiline: boolean, close: string = open): QuoteSpec => ({ open, close, escape, multiline });
const C_BLOCK = { open: '/*', close: '*/', nested: false } as const;
const NESTED_BLOCK = { open: '/*', close: '*/', nested: true } as const;
const C_STRINGS = [q('"', true, false), q("'", true, false)];
const JVM_MARKERS = ['pom.xml', 'build.gradle', 'build.gradle.kts'];
const jvmCheck = (has: (file: string) => boolean): string | undefined => {
  if (has('pom.xml')) return 'mvn -q test-compile';
  if (has('build.gradle') || has('build.gradle.kts')) return has('gradlew') ? './gradlew testClasses' : 'gradle testClasses';
  return undefined;
};

export const JS_PROFILE: LanguageProfile = {
  id: 'js',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
  testFile: [/\.(test|spec)\.[cm]?[tj]sx?$/],
  skipDirs: ['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', '.git'],
  buildDirs: [],
  markers: ['package.json'],
};

export const LANGUAGE_PROFILES: readonly LanguageProfile[] = [
  JS_PROFILE,
  {
    id: 'py',
    extensions: ['.py'],
    testFile: [/(^|\/)test_[^/]*\.py$/, /_test\.py$/, /(^|\/)conftest\.py$/],
    syntax: { lineComments: ['#'], quotes: [q('"""', true, true), q("'''", true, true), ...C_STRINGS] },
    operators: PYTHON_OPERATORS,
    skipDirs: ['__pycache__', '.venv', 'venv', 'site-packages', '.tox', '.mypy_cache', '.pytest_cache'],
    buildDirs: [],
    markers: ['pyproject.toml', 'setup.py', 'setup.cfg', 'pytest.ini'],
    compileCheck: () => 'python3 -m py_compile {file}',
  },
  {
    id: 'go',
    extensions: ['.go'],
    testFile: [/_test\.go$/],
    syntax: { lineComments: ['//'], blockComment: C_BLOCK, quotes: [...C_STRINGS, q('`', false, true)] },
    operators: cLikeOperators('go'),
    skipDirs: [],
    buildDirs: [],
    markers: ['go.mod'],
    compiled: true,
    compileCheck: () => "go test -count=1 -run '^$' ./...",
  },
  {
    id: 'rs',
    extensions: ['.rs'],
    testFile: [/(^|\/)tests\.rs$/],
    syntax: { lineComments: ['//'], blockComment: NESTED_BLOCK, quotes: [q('"', true, true)], rustLiterals: true, cfgTestItems: true },
    operators: RUST_OPERATORS,
    skipDirs: [],
    buildDirs: ['target'],
    markers: ['Cargo.toml'],
    compiled: true,
    compileCheck: () => 'cargo test --no-run',
  },
  {
    id: 'java',
    extensions: ['.java'],
    testFile: [/(Test|Tests)\.java$/, /(^|\/)Test[A-Z][^/]*\.java$/, /(^|\/)src\/test\//],
    syntax: { lineComments: ['//'], blockComment: C_BLOCK, quotes: [q('"""', true, true), ...C_STRINGS] },
    operators: cLikeOperators('java'),
    skipDirs: [],
    buildDirs: ['target', '.gradle', 'build'],
    markers: JVM_MARKERS,
    compiled: true,
    compileCheck: jvmCheck,
  },
  {
    id: 'kt',
    extensions: ['.kt', '.kts'],
    testFile: [/(Test|Tests)\.kts?$/, /(^|\/)src\/test\//],
    syntax: { lineComments: ['//'], blockComment: NESTED_BLOCK, quotes: [q('"""', false, true), ...C_STRINGS] },
    operators: cLikeOperators('kt'),
    skipDirs: [],
    buildDirs: ['target', '.gradle', 'build'],
    markers: JVM_MARKERS,
    compiled: true,
    compileCheck: jvmCheck,
  },
  {
    id: 'cs',
    extensions: ['.cs'],
    testFile: [/(Test|Tests)\.cs$/],
    syntax: { lineComments: ['//'], blockComment: C_BLOCK, quotes: [q('"""', false, true), q('@"', false, true, '"'), ...C_STRINGS] },
    operators: cLikeOperators('cs'),
    skipDirs: [],
    buildDirs: ['bin', 'obj'],
    markers: ['*.csproj', '*.sln'],
    compiled: true,
    compileCheck: () => 'dotnet build',
  },
  {
    id: 'rb',
    extensions: ['.rb'],
    testFile: [/_spec\.rb$/, /_test\.rb$/, /(^|\/)test_[^/]*\.rb$/],
    syntax: { lineComments: ['#'], quotes: C_STRINGS },
    operators: cLikeOperators('rb'),
    skipDirs: ['.bundle'],
    buildDirs: [],
    markers: ['Gemfile'],
  },
  {
    id: 'c',
    extensions: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'],
    testFile: [/(^|\/)test_[^/]*\.(c|cc|cpp|cxx)$/, /_(test|unittest)\.(c|cc|cpp|cxx)$/],
    syntax: { lineComments: ['//'], blockComment: C_BLOCK, quotes: C_STRINGS },
    operators: cLikeOperators('c'),
    skipDirs: [],
    buildDirs: [],
    markers: [],
    compiled: true,
  },
];

export function profileFor(path: string): LanguageProfile | undefined {
  const ext = extname(String(path ?? '')).toLowerCase();
  if (!ext) return undefined;
  return LANGUAGE_PROFILES.find(profile => profile.extensions.includes(ext));
}

/**
 * Mutate-only test rule: every path `isTestFile` accepts plus each profile's own test-file conventions. `isTestFile` stays narrower on purpose — goal/conquer depend on it.
 */
export function isMutationTestFile(path: string): boolean {
  if (isTestFile(path)) return true;
  return LANGUAGE_PROFILES.some(profile => profile.testFile.some(rule => rule.test(path)));
}

const BUILD_SCRIPT_NAMES: readonly string[] = ['build.gradle.kts', 'settings.gradle.kts'];

export function isBuildScript(path: string): boolean {
  return BUILD_SCRIPT_NAMES.includes(basename(path));
}

export function isMutableSource(path: string): boolean {
  return profileFor(path) !== undefined && !isMutationTestFile(path) && !isBuildScript(path);
}

function hasMarker(repoRoot: string, marker: string, rootEntries: () => readonly string[]): boolean {
  if (marker.startsWith('*.')) return rootEntries().some(name => name.endsWith(marker.slice(1)));
  return existsSync(join(repoRoot, marker));
}

/**
 * Directory names a directory-mode walk must not descend into for this repository.
 */
export function mutationSkipDirs(repoRoot: string): string[] {
  let entries: string[] | undefined;
  const rootEntries = (): readonly string[] => {
    if (!entries) { try { entries = readdirSync(repoRoot); } catch { entries = []; } }
    return entries;
  };
  const dirs = new Set<string>();
  for (const profile of LANGUAGE_PROFILES) {
    for (const dir of profile.skipDirs) dirs.add(dir);
    if (profile.buildDirs.length && profile.markers.some(marker => hasMarker(repoRoot, marker, rootEntries))) {
      for (const dir of profile.buildDirs) dirs.add(dir);
    }
  }
  return [...dirs];
}

/**
 * Default test command from non-Node project manifests, or '' when none is recognised. Callers try `fitness:` lines and package.json scripts first.
 */
export function discoverLanguageGate(repoRoot: string): string {
  const has = (file: string): boolean => existsSync(join(repoRoot, file));
  if (['pyproject.toml', 'pytest.ini', 'setup.cfg'].some(has)) return 'python -m pytest';
  if (has('go.mod')) return 'go test ./...';
  if (has('Cargo.toml')) return 'cargo test';
  if (has('pom.xml')) return 'mvn -q test';
  if (has('build.gradle') || has('build.gradle.kts')) return has('gradlew') ? './gradlew test' : 'gradle test';
  return '';
}

/**
 * The compile-only form of the language's test toolchain, used to tell a mutant that breaks compilation (invalid) from one the tests killed. `{file}` is replaced by the shell-quoted path of the mutated file. Undefined when the language has no default check.
 */
export function compileCheckFor(profileId: string, repoRoot: string): string | undefined {
  const has = (file: string): boolean => existsSync(join(repoRoot, file));
  return LANGUAGE_PROFILES.find(profile => profile.id === profileId)?.compileCheck?.(has);
}

/**
 * True for a compiled language with no default compile check: its mutants may only run under an explicit `--build`/`--typecheck`, or a mutant that fails to compile would be graded killed.
 */
export function needsExplicitCheck(profile: LanguageProfile): boolean {
  return profile.compiled === true && profile.compileCheck === undefined;
}

/**
 * Target files that cannot be mutated without an explicit check, in input order. Empty when `explicitCheck` is set.
 */
export function filesNeedingExplicitCheck(files: readonly string[], explicitCheck: boolean, repoRoot: string): string[] {
  if (explicitCheck) return [];
  const checks = compileChecksFor(files, repoRoot);
  return files.filter(file => {
    const profile = profileFor(file);
    return profile?.compiled === true && checks[file] === undefined && checks[profile.id] === undefined;
  });
}

export function explicitCheckNotice(files: readonly string[]): string {
  return `skipping ${files.length} file(s) in a compiled language with no default compile check (${files.join(', ')}) — pass --build or --typecheck so a mutant that does not compile is graded invalid, not killed`;
}

function moduleDirFor(root: string, file: string, markers: readonly string[]): string | undefined {
  if (markers.length === 0) return undefined;
  let dir = dirname(resolve(root, file));
  for (;;) {
    const rel = relative(root, dir);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
    let entries: string[] | undefined;
    const dirEntries = (): readonly string[] => {
      if (!entries) { try { entries = readdirSync(dir); } catch { entries = []; } }
      return entries;
    };
    if (markers.some(marker => hasMarker(dir, marker, dirEntries))) return dir;
    if (rel === '') return undefined;
    dir = dirname(dir);
  }
}

/**
 * Compile checks for every language present in `files`, keyed by profile id. A file whose nearest manifest (within repoRoot) sits in a nested module gets its own entry keyed by its repo-relative path that runs the module's check from the module directory; `{file}` checks never need one.
 */
export function compileChecksFor(files: readonly string[], repoRoot: string): Record<string, string> {
  const root = resolve(repoRoot);
  const checks: Record<string, string> = {};
  for (const file of files) {
    const profile = profileFor(file);
    if (!profile) continue;
    const moduleDir = moduleDirFor(root, file, profile.markers);
    const moduleRel = moduleDir === undefined ? '' : relative(root, moduleDir);
    if (!moduleRel && profile.id in checks) continue;
    const check = compileCheckFor(profile.id, moduleDir ?? root);
    if (!check) continue;
    if (moduleRel && !check.includes('{file}')) checks[file] = `cd ${shellQuote(moduleRel)} && ${check}`;
    else if (!(profile.id in checks)) checks[profile.id] = check;
  }
  return checks;
}
