import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { generateSemanticMutationCandidates } from '@kernlang/agon-support-worktree';
import { generateMutants, generateSemanticMutants, runMutate, runSemanticMutate } from './implementation.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
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
