import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { generateMutants, generateSemanticMutants, runMutate, runSemanticMutate } from './implementation.js';

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-mutate-')); execFileSync('git', ['init', '-b', 'main'], { cwd });
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
