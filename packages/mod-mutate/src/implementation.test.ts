import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { generateSemanticMutationCandidates, generateMechanicalMutants, runMutationAssessment } from '@kernlang/agon-support-worktree';
import * as engineRuntime from '@kernlang/agon-support-engine-runtime';
import { generateMutants, generateSemanticMutants, runMutate, runSemanticMutate } from './implementation.js';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function repo() {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-mutate-')); roots.push(cwd); execFileSync('git', ['init', '-b', 'main'], { cwd });
  execFileSync('git', ['config', 'user.email', 'm@example.invalid'], { cwd }); execFileSync('git', ['config', 'user.name', 'M'], { cwd });
  writeFileSync(join(cwd, 'value.cjs'), 'module.exports = n => n === 2;\n'); writeFileSync(join(cwd, 'test.cjs'), "const f=require('./value.cjs');if(!f(2)||f(3))process.exit(1);\n");
  execFileSync('git', ['add', '.'], { cwd }); execFileSync('git', ['commit', '-m', 'base'], { cwd }); return cwd;
}
function services(response = '') {
  return { identity: {}, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record: vi.fn(async () => 'r') },
    permissions: { check: vi.fn() }, state: { read: vi.fn(), write: vi.fn() },
    engines: { listActive: vi.fn(async () => ['critic']), dispatch: vi.fn(async () => ({ stdout: response })) } } as unknown as ModServices;
}
const context = (cwd: string) => ({ invocationId: 'm', cwd, platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} });
describe('physical mutate mod', () => {
  it.each([undefined, 1, 2000, 'all'] as const)('preserves explicit mutation selection (%s)', async maxMutants => {
    const cwd = repo();
    const source = Array.from({ length: 510 }, (_, index) => `const flag${index} = true;`).join('\n') + '\n';
    writeFileSync(join(cwd, 'value.cjs'), source);
    const generated = generateMechanicalMutants(source, 'value.cjs');
    expect(generated.length).toBeGreaterThan(500);
    const seen = new Set<string>();
    const survivors = generated.slice(500);
    const process = vi.spyOn(engineRuntime, 'spawnWithTimeout').mockImplementation(async options => {
      const current = readFileSync(join(options.cwd!, 'value.cjs'), 'utf8');
      let exitCode = 0;
      if (current !== source) {
        const lines = current.split('\n'), original = source.split('\n');
        const changed = lines.flatMap((line, index) => line === original[index] ? [] : [index]);
        expect(changed).toHaveLength(1);
        const mutant = generated.find(item => item.line === changed[0] + 1 && item.after === lines[changed[0]])!;
        expect(mutant).toBeDefined();
        expect(seen.has(mutant.id)).toBe(false);
        seen.add(mutant.id);
        exitCode = survivors.includes(mutant) ? 0 : 1;
      }
      return { exitCode, stdout: '', stderr: '', timedOut: false, durationMs: 0 };
    });
    const result = await runMutationAssessment({ repoRoot: cwd, files: ['value.cjs'], testCmd: 'fixture mutation test',
      maxMutants, outputDir: join(cwd, 'evidence') }, context(cwd), { engines: services().engines });
    const selected = maxMutants === 'all' ? generated.length : maxMutants === undefined ? 25 : Math.min(500, maxMutants);
    const survived = maxMutants === 'all' ? survivors.length : 0;
    expect(result.ok).toBe(true);
    expect(result.report).toMatchObject({ generated: selected, killed: selected - survived, survived, notRun: 0, budgetExhausted: false });
    expect([...seen]).toEqual(generated.slice(0, selected).map(item => item.id));
    expect((result.survivors as Array<{ id: string }>).map(item => item.id)).toEqual(maxMutants === 'all' ? survivors.map(item => item.id) : []);
    if (survived) expect(result.byFile).toEqual({ 'value.cjs': survivors });
    expect(process).toHaveBeenCalledTimes(selected + 1);
    expect(readFileSync(join(cwd, 'value.cjs'), 'utf8')).toBe(source);
    expect(execFileSync('git', ['worktree', 'list'], { cwd, encoding: 'utf8' }).trim().split('\n')).toHaveLength(1);
  });

  it('selects every changed-line mutant across files without selecting unchanged lines', async () => {
    const cwd = repo(); const source = 'const unchanged = false;\n';
    for (const file of ['a.cjs', 'b.cjs']) writeFileSync(join(cwd, file), source);
    execFileSync('git', ['add', 'a.cjs', 'b.cjs'], { cwd });
    execFileSync('git', ['commit', '-qm', 'unchanged lines'], { cwd });
    const changed = source + Array.from({ length: 260 }, (_, index) => `const flag${index} = true;`).join('\n') + '\n';
    for (const file of ['a.cjs', 'b.cjs']) writeFileSync(join(cwd, file), changed);
    const expected = ['a.cjs', 'b.cjs'].flatMap(file => generateMechanicalMutants(changed, file,
      Array.from({ length: 260 }, (_, index) => index + 2)));
    vi.spyOn(engineRuntime, 'spawnWithTimeout').mockImplementation(async options => ({
      exitCode: ['a.cjs', 'b.cjs'].every(file => readFileSync(join(options.cwd!, file), 'utf8') === changed) ? 0 : 1,
      stdout: '', stderr: '', timedOut: false, durationMs: 0,
    }));
    const diff = execFileSync('git', ['diff', 'HEAD'], { cwd, encoding: 'utf8' });
    const result = await runMutationAssessment({ repoRoot: cwd, diff, testCmd: 'fixture mutation test', maxMutants: 'all',
      outputDir: join(cwd, 'evidence') }, context(cwd), { engines: services().engines });
    expect(result.ok).toBe(true);
    const report = result.report as { generated: number; outcomes: Array<{ mutant: { id: string; line: number } }> };
    expect(report.generated).toBeGreaterThan(500);
    expect(report.outcomes.map(item => item.mutant.id)).toEqual(expected.map(item => item.id));
    expect(report.outcomes.every(item => item.mutant.line > 1)).toBe(true);
    for (const file of ['a.cjs', 'b.cjs']) expect(readFileSync(join(cwd, file), 'utf8')).toBe(changed);
    expect(execFileSync('git', ['worktree', 'list'], { cwd, encoding: 'utf8' }).trim().split('\n')).toHaveLength(1);
  });

  it('retains the full selected pool and no kill verdict when exhaustive execution is cancelled', async () => {
    const cwd = repo(); const abort = new AbortController();
    const source = Array.from({ length: 510 }, (_, index) => `const flag${index} = true;`).join('\n') + '\n';
    writeFileSync(join(cwd, 'value.cjs'), source);
    const expected = generateMechanicalMutants(source, 'value.cjs').length;
    let calls = 0;
    vi.spyOn(engineRuntime, 'spawnWithTimeout').mockImplementation(async () => {
      if (++calls === 2) abort.abort();
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 0 };
    });
    const result = await runMutationAssessment({ repoRoot: cwd, files: ['value.cjs'], testCmd: 'fixture mutation test',
      maxMutants: 'all', outputDir: join(cwd, 'evidence') }, { ...context(cwd), signal: abort.signal }, { engines: services().engines });
    expect(result.ok).toBe(false);
    expect(result.report).toMatchObject({ generated: expected, killed: 0, outcomes: [], notRun: expected, aborted: true });
    expect(calls).toBe(2);
    expect(readFileSync(join(cwd, 'value.cjs'), 'utf8')).toBe(source);
    expect(execFileSync('git', ['worktree', 'list'], { cwd, encoding: 'utf8' }).trim().split('\n')).toHaveLength(1);
  });

  it.each(['no-build', 'rebuild', 'unsafe-overlay'])('does not test stale workspace artifacts (%s)', async mode => {
    const cwd = repo();
    const rebuild = mode === 'rebuild';
    const packageName = mode === 'unsafe-overlay' ? '@scope/sample' : 'sample';
    const source = 'module.exports = n => n === 2;\n';
    mkdirSync(join(cwd, 'packages/sample/src'), { recursive: true });
    mkdirSync(join(cwd, 'packages/sample/dist'));
    mkdirSync(join(cwd, 'node_modules'));
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
    writeFileSync(join(cwd, '.gitignore'), 'node_modules/\n**/dist/\nscope-root/\n');
    writeFileSync(join(cwd, 'packages/sample/package.json'), JSON.stringify({ name: packageName, main: 'dist/index.cjs' }));
    writeFileSync(join(cwd, 'packages/sample/src/index.cjs'), source);
    writeFileSync(join(cwd, 'packages/sample/dist/index.cjs'), source);
    if (mode === 'unsafe-overlay') {
      mkdirSync(join(cwd, 'scope-root'));
      symlinkSync('../packages/sample', join(cwd, 'scope-root/sample'), 'dir');
      symlinkSync('../scope-root', join(cwd, 'node_modules/@scope'), 'dir');
    } else symlinkSync('../packages/sample', join(cwd, 'node_modules/sample'), 'dir');
    writeFileSync(join(cwd, 'test.cjs'), `const f=require('${packageName}');if(!f(2)||f(3))process.exit(1);\n`);
    execFileSync('git', ['add', 'package.json', '.gitignore', 'packages/sample/package.json', 'packages/sample/src/index.cjs', 'test.cjs'], { cwd });
    execFileSync('git', ['commit', '-qm', 'workspace fixture'], { cwd });
    const out = await runMutate({ path: 'packages/sample/src/index.cjs', test: 'node test.cjs',
      ...(rebuild ? { build: 'mkdir -p packages/sample/dist && cp packages/sample/src/index.cjs packages/sample/dist/index.cjs' } : {}) }, context(cwd), services());
    if (rebuild) {
      expect(out.exitCode).toBe(0);
      expect((out.result as any).killed).toBeGreaterThan(0);
      expect((out.result as any).survived).toBe(0);
    } else if (mode === 'unsafe-overlay') {
      expect(out.exitCode).toBe(1);
      expect(out.stderr).toContain('Mutation sandbox dependency setup failed');
      expect((out.result as any).report.outcomes).toEqual([]);
      expect(out.failure).toBeUndefined();
    } else {
      expect(out.exitCode).toBe(1);
      expect(out.failure?.code).toBe('MUTATE_BASELINE_RED');
      expect(out.stderr).toContain('--build');
      expect((out.result as any).report.baselineOk).toBe(false);
      expect((out.result as any).report.outcomes).toEqual([]);
    }
    expect(readFileSync(join(cwd, 'packages/sample/dist/index.cjs'), 'utf8')).toBe(source);
    expect(readFileSync(join(cwd, 'packages/sample/src/index.cjs'), 'utf8')).toBe(source);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })).toBe('');
    expect(execFileSync('git', ['worktree', 'list'], { cwd, encoding: 'utf8' }).trim().split('\n')).toHaveLength(1);
  });

  it.each(['deadline', 'abort'])('bounds stalled semantic discovery by %s', async reason => {
    const abort = new AbortController();
    let release!: (ids: string[]) => void;
    let discoverySignal: AbortSignal | undefined;
    const dispatch = vi.fn();
    const pending = generateSemanticMutationCandidates('value.cjs', 'module.exports = true;', [], 1,
      { cwd: tmpdir(), signal: abort.signal }, { dispatch, listActive: ctx => {
        discoverySignal = ctx.signal;
        return new Promise<string[]>(resolve => { release = resolve; });
      } }, undefined, Date.now() + (reason === 'deadline' ? 50 : 5000));
    if (reason === 'abort') abort.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([pending, new Promise<'stalled'>(resolve => {
        timer = setTimeout(() => resolve('stalled'), 250);
      })]);
      expect(result).not.toBe('stalled');
      expect(discoverySignal?.aborted).toBe(true);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      clearTimeout(timer);
      release([]);
      await pending;
    }
  });
  it('rebuilds every mutant before testing its compiled output', async () => {
    const cwd = repo();
    const out = await runMutate({ path: 'value.cjs', build: 'cp value.cjs built.cjs',
      test: `node -e "const f=require('./built.cjs');if(!f(2)||f(3))process.exit(1)"` }, context(cwd), services());
    expect(out.exitCode).toBe(0);
    expect((out.result as any).killed).toBeGreaterThan(0);
    expect((out.result as any).survived).toBe(0);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })).toBe('');
  });
  it('grades a mutant rejected by typecheck as invalid rather than killed', async () => {
    const cwd = repo();
    const out = await runMutate({ path: 'value.cjs', typecheck: 'node test.cjs', test: 'node test.cjs' }, context(cwd), services());
    expect(out.exitCode).toBe(0);
    expect((out.result as any).invalid).toBeGreaterThan(0);
    expect((out.result as any).killed).toBe(0);
  });
  it('bounds the baseline by the total budget', async () => {
    const cwd = repo(), marker = join(cwd, 'late-baseline');
    const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'late')`;
    const out = await runMutate({ path: 'value.cjs', budget: 1,
      test: `sleep 1.25; node -e ${JSON.stringify(script)}` }, context(cwd), services());
    expect(existsSync(marker)).toBe(false);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).report.budgetExhausted).toBe(true);
    expect((out.result as any).report.killed).toBe(0);
  });
  it('does not call semantic engines on a red baseline', async () => {
    const cwd = repo(), svc = services();
    const out = await runSemanticMutate({ path: 'value.cjs', test: 'false' }, context(cwd), svc);
    expect(out.failure?.code).toBe('MUTATE_BASELINE_RED');
    expect(svc.engines.dispatch).not.toHaveBeenCalled();
  });
  it('caps semantic dispatch by the remaining budget and stops after cancellation', async () => {
    const cwd = repo(), svc = services(), abort = new AbortController();
    const calls: unknown[] = [];
    vi.mocked(svc.engines.dispatch).mockImplementation(async (_engine, _prompt, _context, options) => {
      calls.push(options);
      abort.abort();
      return { stdout: '[]' };
    });
    const out = await runSemanticMutate({ path: 'value.cjs', test: 'sleep 0.25; node test.cjs', engines: 'first,second', budget: 3 },
      { ...context(cwd), signal: abort.signal }, svc);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { timeoutSeconds: number }).timeoutSeconds).toBeGreaterThan(0);
    expect((calls[0] as { timeoutSeconds: number }).timeoutSeconds).toBeLessThanOrEqual(2.75);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).report.aborted).toBe(true);
    expect((out.result as any).report.killed).toBe(0);
    expect((out.result as any).report.notRun).toBeGreaterThan(0);
  });
  it('does not count cancellation during a mutant as a kill', async () => {
    const cwd = repo(), marker = join(cwd, 'mutant-started'), abort = new AbortController();
    const original = readFileSync(join(cwd, 'value.cjs'), 'utf8');
    const script = `const fs=require('node:fs');if(!fs.existsSync('baseline'))fs.writeFileSync('baseline','ok');else {fs.writeFileSync(${JSON.stringify(marker)},'ready');setTimeout(()=>{},10000)}`;
    const pending = runMutate({ path: 'value.cjs', test: `node -e ${JSON.stringify(script)}` },
      { ...context(cwd), signal: abort.signal }, services());
    let out;
    try { await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 5000 }); }
    finally { abort.abort(); out = await pending; }
    expect(out.exitCode).toBe(1);
    expect((out.result as any).report.aborted).toBe(true);
    expect((out.result as any).report.killed).toBe(0);
    expect(readFileSync(join(cwd, 'value.cjs'), 'utf8')).toBe(original);
  });
  it('runs mechanical mutants only in a disposable worktree', async () => {
    const cwd = repo(); const out = await runMutate({ path: 'value.cjs', test: 'node test.cjs', maxMutants: 5 }, context(cwd), services());
    expect(out.exitCode).toBe(0); expect((out.result as any).killed).toBeGreaterThan(0); expect(existsSync(join(cwd, 'value.cjs'))).toBe(true);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })).toBe('');
  });
  it('validates semantic proposals against exact source and runs the accepted mutant', async () => {
    const cwd = repo(), source = 'module.exports = n => n === 2;\n';
    const svc = services(JSON.stringify([{ line: 1, before: 'module.exports = n => n === 2;', after: 'module.exports = n => n !== 2;', why: 'inverted result' }, { line: 99, before: 'fake', after: 'bad' }]));
    const generated = await generateSemanticMutants(source, 'value.cjs', '', svc, context(cwd), 5);
    expect(generated).toHaveLength(1); expect(generated[0]?.origin).toBe('semantic');
    const out = await runSemanticMutate({ path: 'value.cjs', test: 'node test.cjs', semantic: true }, context(cwd), svc);
    expect(out.exitCode).toBe(0); expect((out.result as any).killed).toBe(1); expect((out.result as any).semantic).toBe(true);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })).toBe('');
  });
  it('ignores comments and rejects a red baseline', async () => {
    expect(generateMutants('// true === false', 'x.ts')).toHaveLength(0); const cwd = repo();
    expect((await runMutate({ path: 'value.cjs', test: 'false' }, context(cwd), services())).failure?.code).toBe('MUTATE_BASELINE_RED');
  });
});
