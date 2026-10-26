import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverGate } from '@kernlang/agon-core';
import {
  JS_PROFILE, LANGUAGE_PROFILES, compileCheckFor, compileChecksFor, discoverLanguageGate, discoverMutationGate,
  generateMechanicalMutants, generateMutants, isMutableSource, isMutationTestFile, isTestFile, lexSource,
  filesNeedingExplicitCheck, isBuildScript, mutationSkipDirs, needsExplicitCheck, profileFor,
} from '../../packages/support-worktree/src/index.js';
import type { LanguageProfile, Mutant } from '../../packages/support-worktree/src/index.js';

const allLines = (src: string): number[] => src.split('\n').map((_, i) => i + 1);
const profile = (id: string): LanguageProfile => {
  const found = LANGUAGE_PROFILES.find(p => p.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
};
const gen = (id: string, src: string, lines: number[] = allLines(src)): Mutant[] =>
  generateMutants(src, lines, undefined, profile(id));
const ops = (id: string, src: string, lines?: number[]): string[] => gen(id, src, lines).map(m => m.operator);
const afters = (id: string, src: string, lines?: number[]): string[] => gen(id, src, lines).map(m => m.after);

const dirs: string[] = [];
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'agon-mutation-languages-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true }); });

describe('AC-1 JS default profile byte-identical', () => {
  it('AC-1 `return a + b;` keeps arith and ret mutants', () => {
    expect(generateMutants('return a + b;', [1], 'src/a.ts').map(m => [m.id, m.after, m.class])).toEqual([
      ['src/a.ts:arith:+→-@L1', 'return a - b;', 'high-signal'],
      ['src/a.ts:ret:→undefined@L1', 'return undefined;', 'equiv-prone'],
    ]);
  });

  it('AC-1 `.mts` file mutates exactly as before', () => {
    const src = 'export const f = (a: number, b: number): boolean => a === b || a < b && !false;';
    expect(generateMutants(src, [1], 'src/a.mts').map(m => [m.id, m.after])).toEqual([
      ['src/a.mts:eq:===→!==@L1', 'export const f = (a: number, b: number): boolean => a !== b || a < b && !false;'],
      ['src/a.mts:logic:&&→||@L1', 'export const f = (a: number, b: number): boolean => a === b || a < b || !false;'],
      ['src/a.mts:logic:||→&&@L1', 'export const f = (a: number, b: number): boolean => a === b && a < b && !false;'],
      ['src/a.mts:rel:<→>=@L1', 'export const f = (a: number, b: number): boolean => a === b || a >= b && !false;'],
      ['src/a.mts:bool:false→true@L1', 'export const f = (a: number, b: number): boolean => a === b || a < b && !true;'],
    ]);
  });

  it('AC-1 template literal spanning lines keeps whole-line semantics', () => {
    const src = 'const s = `\n${a + b} /* x\n`;\nconst y = a - b > c ? true : [];';
    expect(generateMutants(src, allLines(src), 'src/t.ts').map(m => [m.id, m.after])).toEqual([
      ['src/t.ts:arith:+→-@L2', '${a - b} /* x'],
      ['src/t.ts:arith:-→+@L4', 'const y = a + b > c ? true : [];'],
      ['src/t.ts:rel:>→<=@L4', 'const y = a - b <= c ? true : [];'],
      ['src/t.ts:bool:true→false@L4', 'const y = a - b > c ? false : [];'],
      ['src/t.ts:arr:[]→[0]@L4', 'const y = a - b > c ? true : [0];'],
    ]);
  });

  it('AC-1 JS still mutates inside strings and trailing comments', () => {
    expect(generateMutants("const s = 'a + b' + x; // a && b", [1]).map(m => [m.id, m.after])).toEqual([
      ['arith:+→-@L1', "const s = 'a - b' + x; // a && b"],
      ['logic:&&→||@L1', "const s = 'a + b' + x; // a || b"],
    ]);
    expect(generateMutants('if (x !== y && z >= 1) return [] ;', [1], 'src/m.js').map(m => m.after)).toEqual([
      'if (x === y && z >= 1) return [] ;',
      'if (x !== y || z >= 1) return [] ;',
      'if (x !== y && z >= 1) return undefined;',
      'if (x !== y && z >= 1) return [0] ;',
    ]);
  });

  it('AC-1 passing the JS profile explicitly equals the default', () => {
    const src = 'const ok = a + b === c && d < e ? true : [];';
    expect(generateMutants(src, [1], 'src/a.ts', JS_PROFILE)).toEqual(generateMutants(src, [1], 'src/a.ts'));
    expect(profileFor('src/a.mts')).toBe(JS_PROFILE);
  });
});

describe('AC-2 per-language type-safe operators', () => {
  it('AC-2 python `if a and not b:`', () => {
    expect(afters('py', 'if a and not b:')).toEqual(['if a or not b:']);
    expect(ops('py', 'if a and not b:')).toEqual(['py:and→or']);
  });

  it('AC-2 python booleans, identity and membership', () => {
    expect(afters('py', 'flag = True')).toEqual(['flag = False']);
    expect(afters('py', 'if x is None:')).toEqual(['if x is not None:']);
    expect(afters('py', 'if x is not None:')).toEqual(['if x is None:']);
    expect(afters('py', 'if k in d:')).toEqual(['if k not in d:']);
    expect(afters('py', 'if k not in d:')).toEqual(['if k in d:']);
    expect(gen('py', 'for k in d:')).toEqual([]);
    expect(afters('py', 'ok = a == b or c != d')).toEqual(['ok = a != b or c != d', 'ok = a == b or c == d', 'ok = a == b and c != d']);
  });

  it('AC-2 go `if err != nil {`', () => {
    expect(gen('go', 'if err != nil {').map(m => [m.operator, m.after])).toEqual([['go:!=→==', 'if err == nil {']]);
  });

  it('AC-2 rust `x == y && z`', () => {
    expect(gen('rs', 'x == y && z').map(m => [m.operator, m.after])).toEqual([
      ['rs:==→!=', 'x != y && z'],
      ['rs:&&→||', 'x == y || z'],
    ]);
  });

  it('AC-2 rust is_some/is_none and is_ok/is_err', () => {
    expect(afters('rs', 'if v.is_some() {')).toEqual(['if v.is_none() {']);
    expect(afters('rs', 'if r.is_err() {')).toEqual(['if r.is_ok() {']);
  });

  it('AC-2 java `return a >= b;`', () => {
    expect(gen('java', 'return a >= b;').map(m => [m.operator, m.after])).toEqual([['java:>=→<', 'return a < b;']]);
  });

  it('AC-2 no return-value or `?` mutants mechanically', () => {
    expect(gen('go', 'return value')).toEqual([]);
    expect(gen('rs', 'let x = parse(s)?;')).toEqual([]);
    expect(gen('java', 'return value;')).toEqual([]);
  });

  it('AC-2 every operator-bearing line gets at least one mutant per language', () => {
    expect(ops('py', 'total = a + b')).toEqual(['py:+→-']);
    expect(ops('go', 'total := a - b')).toEqual(['go:-→+']);
    expect(ops('rs', 'if a < b { return; }')).toEqual(['rs:<→>=']);
    expect(ops('java', 'if (a == b || c) {')).toEqual(['java:==→!=', 'java:||→&&']);
    expect(ops('kt', 'val ok = a > b && true')).toEqual(['kt:&&→||', 'kt:>→<=', 'kt:true→false']);
    expect(ops('cs', 'var ok = a <= b;')).toEqual(['cs:<=→>']);
  });

  it('AC-2 rust `Vec<T>` yields no relational or arithmetic mutants', () => {
    expect(gen('rs', 'let v: Vec<T> = Vec::new();')).toEqual([]);
  });

  it('AC-2 rust closure `|x| x->y` yields nothing', () => {
    expect(gen('rs', 'let f = |x| x->y;')).toEqual([]);
  });

  it('AC-2 rust `match v { A => 1 }` yields nothing', () => {
    expect(gen('rs', 'match v { A => 1 }')).toEqual([]);
  });

  it('AC-2 go `ch <- v` yields nothing', () => {
    expect(gen('go', 'ch <- v')).toEqual([]);
  });

  it('AC-2 go `func F[T any]()` yields nothing', () => {
    expect(gen('go', 'func F[T any]() {}')).toEqual([]);
  });

  it('AC-2 rust `Vec<Vec<u8>>` yields nothing', () => {
    expect(gen('rs', 'let v: Vec<Vec<u8>> = vec![];')).toEqual([]);
  });

  it('AC-2 rust shift `a >> 2` is untouched and earns no relational mutant', () => {
    expect(gen('rs', 'let s = a >> 2;')).toEqual([]);
  });

  it('AC-2 rust double reference and empty closure are not logic operators', () => {
    expect(gen('rs', 'call(&&x);')).toEqual([]);
    expect(gen('rs', 'spawn(move || work());')).toEqual([]);
  });
});

describe('AC-3 no mutants in comments, docstrings or strings', () => {
  it('AC-3 python `"""` docstring spanning 3 lines with `+` inside', () => {
    const src = '"""\nreturns a + b\n"""\ny = a + b';
    expect(gen('py', src).map(m => m.line)).toEqual([4]);
  });

  it('AC-3 python `# a + b`', () => {
    expect(gen('py', '# a + b')).toEqual([]);
  });

  it('AC-3 rust `/// a || b`', () => {
    expect(gen('rs', '/// a || b')).toEqual([]);
  });

  it("AC-3 rust lifetime `fn f<'a>(x: &'a str)` does not open a string", () => {
    const src = "fn f<'a>(x: &'a str) -> bool { a + b == c }\nlet z = a && b;";
    expect(ops('rs', src)).toEqual(['rs:+→-', 'rs:==→!=', 'rs:&&→||']);
  });

  it("AC-3 rust `where T: 'a` does not open a string", () => {
    const src = "where T: 'a,\n{ a && b }";
    expect(gen('rs', src).map(m => [m.line, m.operator])).toEqual([[2, 'rs:&&→||']]);
  });

  it("AC-3 rust loop label `'outer: loop`", () => {
    expect(ops('rs', "'outer: loop { if a && b { break 'outer; } }")).toEqual(['rs:&&→||']);
  });

  it("AC-3 rust byte char `b'x'`", () => {
    expect(afters('rs', "let c = b'+' == d;")).toEqual(["let c = b'+' != d;"]);
    expect(afters('rs', "let c = b'x' + 1;\nlet d = a && b;")).toEqual(["let c = b'x' - 1;", 'let d = a || b;']);
  });

  it(`AC-3 rust raw string \`r#"don't"#\``, () => {
    expect(afters('rs', 'let s = r#"don\'t && a + b"#; let t = a + b;')).toEqual(['let s = r#"don\'t && a + b"#; let t = a - b;']);
    expect(gen('rs', 'let s = r#"\na + b\n"#;\nlet t = c && d;').map(m => m.line)).toEqual([4]);
  });

  it('AC-3 CRLF line endings', () => {
    const src = 'x = a + b\r\n# c and d\r\ny = c and d\r\n';
    expect(gen('py', src).map(m => [m.line, m.after])).toEqual([[1, 'x = a - b\r'], [3, 'y = c or d\r']]);
    expect(gen('go', '/* a + b\r\n*/\r\nx := a + b\r').map(m => [m.line, m.after])).toEqual([[3, 'x := a - b\r']]);
  });

  it('AC-3 `print("a + b") + x` mutates only the outer `+`', () => {
    expect(afters('py', 'print("a + b") + x')).toEqual(['print("a + b") - x']);
  });

  it('AC-3 go `s := "a && b" ` yields nothing', () => {
    expect(gen('go', 's := "a && b" ')).toEqual([]);
  });

  it('AC-3 `result = a + b  # explain x + y` mutates only the first `+`', () => {
    expect(afters('py', 'result = a + b  # explain x + y')).toEqual(['result = a - b  # explain x + y']);
  });

  it('AC-3 `return ok; // a && b` yields no logic mutant', () => {
    for (const id of ['go', 'rs', 'java', 'kt', 'cs', 'c']) expect(gen(id, 'return ok; // a && b')).toEqual([]);
  });

  it('AC-3 `x = 1  # a and b` yields nothing', () => {
    expect(gen('py', 'x = 1  # a and b')).toEqual([]);
  });

  it('AC-3 go raw string `a+b` spanning lines', () => {
    const src = 'x := `a + b\nc && d\n`\ny := a && b';
    expect(gen('go', src).map(m => [m.line, m.after])).toEqual([[4, 'y := a || b']]);
  });

  it('AC-3 java text block `"""`', () => {
    const src = 'String s = """\n  a + b && c\n  """;\nboolean t = a && b;';
    expect(gen('java', src).map(m => [m.line, m.after])).toEqual([[4, 'boolean t = a || b;']]);
  });

  it('AC-3 python `*args` line is code, not a comment', () => {
    expect(lexSource('def f(*args):', profile('py').syntax!)[0].code.length).toBeGreaterThan(0);
    expect(afters('py', 'total = f(*args) + 1')).toEqual(['total = f(*args) - 1']);
  });

  it('AC-3 string-only and block-comment lines in every C-like profile yield nothing', () => {
    for (const id of ['go', 'rs', 'java', 'kt', 'cs', 'c']) {
      expect(gen(id, '"a + b"')).toEqual([]);
      expect(gen(id, '/*\n a && b\n*/')).toEqual([]);
    }
    expect(gen('rb', '# a && b\n"a + b"')).toEqual([]);
  });

  it('AC-3 nested rust block comments stay closed until the outer close', () => {
    expect(gen('rs', '/* a /* b */ a + b */\nlet x = a + b;').map(m => m.line)).toEqual([2]);
  });
});

describe('AC-4 multi-language test paths', () => {
  it.each([
    'test_x.py', 'pkg/x_test.py', 'conftest.py', 'x_test.go', 'src/XTest.java', 'XTests.cs', 'spec/x_spec.rb',
    'lib/x_spec.rb', 'src/test/java/A.java', 'src/TestParser.java',
  ])('AC-4 %s is a mutation test file', path => {
    expect(isMutationTestFile(path)).toBe(true);
    expect(isMutableSource(path)).toBe(false);
  });

  it.each(['latest.py', 'contest.go', 'attestation.rs', 'src/Contest.java'])('AC-4 %s is source', path => {
    expect(isMutationTestFile(path)).toBe(false);
    expect(isMutableSource(path)).toBe(true);
  });

  it.each(['tests/a.ts', '__tests__/b.js', 'spec/c.ts', 'src/d.test.tsx', 'src/e.spec.mjs'])('AC-4 every isTestFile path (%s) stays a test', path => {
    expect(isTestFile(path)).toBe(true);
    expect(isMutationTestFile(path)).toBe(true);
  });

  it('AC-4 isTestFile itself is unchanged for the new conventions', () => {
    for (const path of ['test_x.py', 'x_test.go', 'XTest.java', 'conftest.py']) expect(isTestFile(path)).toBe(false);
  });

  it('AC-4 `testing_utils.py` is source', () => {
    expect(isMutationTestFile('testing_utils.py')).toBe(false);
    expect(isMutableSource('testing_utils.py')).toBe(true);
  });

  it('AC-4 `tests.rs` at crate root is a test module', () => {
    expect(isMutationTestFile('tests.rs')).toBe(true);
    expect(isMutationTestFile('src/tests.rs')).toBe(true);
  });

  it('AC-4 unknown extensions are not mutable sources', () => {
    expect(isMutableSource('README.md')).toBe(false);
    expect(isMutableSource('Makefile')).toBe(false);
  });
});

describe('AC-6 gate discovery', () => {
  it.each([
    [{ 'pyproject.toml': '' }, 'python -m pytest'],
    [{ 'pytest.ini': '' }, 'python -m pytest'],
    [{ 'setup.cfg': '' }, 'python -m pytest'],
    [{ 'go.mod': 'module x' }, 'go test ./...'],
    [{ 'Cargo.toml': '' }, 'cargo test'],
    [{ 'pom.xml': '' }, 'mvn -q test'],
    [{ 'build.gradle': '' }, 'gradle test'],
    [{ 'build.gradle.kts': '', gradlew: '' }, './gradlew test'],
    [{}, ''],
  ] as Array<[Record<string, string>, string]>)('AC-6 %j → %s from both pipelines', (files, gate) => {
    const dir = repo(files);
    expect(discoverLanguageGate(dir)).toBe(gate);
    expect(discoverMutationGate(dir)).toBe(gate);
  });

  it('AC-6 repo with package.json (no test script) and pyproject.toml', () => {
    const dir = repo({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }), 'pyproject.toml': '' });
    expect(discoverMutationGate(dir)).toBe('python -m pytest');
  });

  it('AC-6 a package.json test script still wins over manifests', () => {
    const dir = repo({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }), 'pyproject.toml': '' });
    expect(discoverMutationGate(dir)).toBe('npm run test');
  });

  it('AC-6 `fitness:` line in AGENTS.md wins over all', () => {
    const dir = repo({ 'AGENTS.md': '# repo\n\nfitness: make check\n', 'pyproject.toml': '', 'go.mod': 'module x' });
    expect(discoverGate(dir).command).toBe('make check');
  });
});

describe('AC-5/AC-11 compile-only check per profile', () => {
  it('AC-5 compiled languages get the compile-only form of their test toolchain', () => {
    expect(compileCheckFor('go', repo({}))).toBe("go test -count=1 -run '^$' ./...");
    expect(compileCheckFor('rs', repo({}))).toBe('cargo test --no-run');
    expect(compileCheckFor('java', repo({ 'pom.xml': '' }))).toBe('mvn -q test-compile');
    expect(compileCheckFor('kt', repo({ 'build.gradle.kts': '', gradlew: '' }))).toBe('./gradlew testClasses');
    expect(compileCheckFor('java', repo({ 'build.gradle': '' }))).toBe('gradle testClasses');
    expect(compileCheckFor('java', repo({}))).toBeUndefined();
    expect(compileCheckFor('cs', repo({}))).toBe('dotnet build');
  });

  it('AC-11 python checks the mutated file with py_compile', () => {
    expect(compileCheckFor('py', repo({}))).toBe('python3 -m py_compile {file}');
  });

  it('AC-5 JS/TS, Ruby and C/C++ have no default check', () => {
    for (const id of ['js', 'rb', 'c']) expect(compileCheckFor(id, repo({}))).toBeUndefined();
  });

  it('review: only a compiled profile with no default check needs an explicit --build/--typecheck', () => {
    expect(needsExplicitCheck(profile('c'))).toBe(true);
    for (const id of ['go', 'rs', 'java', 'kt', 'cs', 'py', 'js', 'rb']) expect(needsExplicitCheck(profile(id))).toBe(false);
  });

  it('review: a compiled file with no resolvable compile check needs an explicit --build/--typecheck', () => {
    expect(filesNeedingExplicitCheck(['A.java', 'b.kt', 'c.go', 'd.py', 'e.cpp'], false, repo({}))).toEqual(['A.java', 'b.kt', 'e.cpp']);
    expect(filesNeedingExplicitCheck(['A.java', 'b.kt', 'e.cpp'], false, repo({ 'pom.xml': '<project/>' }))).toEqual(['e.cpp']);
    expect(filesNeedingExplicitCheck(['A.java', 'e.cpp'], true, repo({}))).toEqual([]);
  });

  it('review: Gradle Kotlin build scripts are never mutation sources', () => {
    for (const path of ['build.gradle.kts', 'app/settings.gradle.kts']) {
      expect(isBuildScript(path)).toBe(true);
      expect(isMutableSource(path)).toBe(false);
    }
    expect(isMutableSource('src/Build.kts')).toBe(true);
  });

  it('AC-5 checks are keyed by the profile of each target file', () => {
    expect(compileChecksFor(['a.go', 'src/b.rs', 'c.ts', 'd.go'], repo({}))).toEqual({
      go: "go test -count=1 -run '^$' ./...", rs: 'cargo test --no-run',
    });
  });
});

describe('AC-9 rust cfg(test)', () => {
  it('AC-9 a `#[cfg(test)] mod tests` block with nested braces is skipped', () => {
    const src = [
      'fn add(a: i32, b: i32) -> i32 { a + b }',
      '#[cfg(test)]',
      'mod tests {',
      '    #[test]',
      '    fn adds() {',
      '        if 1 + 1 == 2 { assert!(true); }',
      '        let s = "}";',
      '    }',
      '}',
      'fn sub(a: i32, b: i32) -> i32 { a - b }',
    ].join('\n');
    expect(gen('rs', src).map(m => m.line)).toEqual([1, 10]);
  });

  it('AC-9 `#[cfg(test)]` on a single fn skips only that fn', () => {
    const src = '#[cfg(test)]\nfn helper() -> bool { a && b }\nfn real() -> bool { a && b }';
    expect(gen('rs', src).map(m => m.line)).toEqual([3]);
  });

  it('AC-9 `#[cfg(test)]` on a braceless item ends at its semicolon', () => {
    const src = '#[cfg(test)]\nuse crate::helpers::*;\nfn real() -> bool { a && b }';
    expect(gen('rs', src).map(m => m.line)).toEqual([3]);
  });

  it('review: `;` inside parens or brackets before the body does not end the skip', () => {
    const src = '#[cfg(test)]\nfn helper(buf: [u8; 4]) -> bool {\n  a && b\n}\nfn real() -> bool { a && b }';
    expect(gen('rs', src).map(m => m.line)).toEqual([5]);
  });
});

describe('profile-driven modular pipeline', () => {
  it('mutates python files by their own profile', () => {
    expect(generateMechanicalMutants('if a and b:\n    return x + 1', 'src/m.py').map(m => [m.id, m.after])).toEqual([
      ['src/m.py:py:and→or@L1', 'if a or b:'],
      ['src/m.py:py:+→-@L2', '    return x - 1'],
    ]);
  });

  it('skips language build directories only when the language marker exists', () => {
    expect(mutationSkipDirs(repo({}))).not.toContain('target');
    expect(mutationSkipDirs(repo({}))).toContain('__pycache__');
    expect(mutationSkipDirs(repo({ 'Cargo.toml': '' }))).toContain('target');
    expect(mutationSkipDirs(repo({ 'App.csproj': '' }))).toEqual(expect.arrayContaining(['bin', 'obj']));
  });
});
