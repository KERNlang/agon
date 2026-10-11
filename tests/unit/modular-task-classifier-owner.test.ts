import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as core from '../../packages/core/src/blocks/task-classifier.js';
import * as owner from '@kernlang/agon-support-dedup';
import { classifyTask as publicClassify } from '@kernlang/agon-core';

let root: string;
let calls: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agon-classifier-owner-'));
  calls = join(root, 'calls.ndjson');
  const executable = join(root, 'fixture-classifier');
  writeFileSync(calls, '');
  writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), input }) + '\\n');
if (input.text === 'stall') setTimeout(() => {}, 10000);
else if (input.text === 'exit') process.exit(2);
else if (input.text === 'empty') process.exit(0);
else if (input.text === 'malformed') process.stdout.write('{');
else process.stdout.write(JSON.stringify({ class: input.text === 'opaque prose' ? 'feature' : input.text }));
`);
  chmodSync(executable, 0o700);
  vi.stubEnv('AGON_HOME', root);
  vi.stubEnv('AGON_PYTHON', executable);
  vi.stubEnv(core.CLASSIFIER_DISABLE_ENV, '');
  core.CLASSIFIER_CACHE.clear();
});

afterEach(() => {
  core.CLASSIFIER_CACHE.clear();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('task classifier physical ownership', () => {
  it('retains the public functions and shared cache through one support owner', () => {
    expect(publicClassify).toBe(owner.classifyTask);
    for (const key of Object.keys(core) as Array<keyof typeof core>) {
      expect((owner as unknown as Record<string, unknown>)[key], key).toBe(core[key]);
    }
  });

  it('compiles the public result and cache contracts without a new package dependency', () => {
    const path = fileURLToPath(new URL('../classifier-compile-only.ts', import.meta.url));
    const source = `
      import { classifyTask as coreClassify } from '@kernlang/agon-core';
      import { classifyTask, classifyTaskSemantic, CLASSIFIER_CACHE } from '@kernlang/agon-support-dedup';
      import type { TaskClass } from '@kernlang/agon-support-engine-runtime';
      const forward: (input: string) => TaskClass = classifyTask;
      const core: typeof classifyTask = coreClassify;
      const reverse: typeof classifyTask = (_input: string) => (null! as TaskClass);
      const semantic: TaskClass | null = classifyTaskSemantic('input');
      const cache: Map<string, TaskClass> = CLASSIFIER_CACHE;
      const reverseCache: typeof CLASSIFIER_CACHE = new Map<string, TaskClass>();
      // @ts-expect-error Invalid classes must remain rejected.
      CLASSIFIER_CACHE.set('input', 'invalid');
      // @ts-expect-error Non-string input must remain rejected.
      classifyTask(42);
    `;
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [] };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (name, version, onError, fresh) => name === path
      ? ts.createSourceFile(name, source, version, true)
      : original(name, version, onError, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([path], options, host));
    expect(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  });

  it('detects changes to regex priority, cache reuse and the semantic bypass', () => {
    const source = readFileSync(new URL('../../packages/support-dedup/src/task-classifier.ts', import.meta.url), 'utf8');
    const probe = (input: string) => {
      let calls = 0;
      const exports = {} as typeof core;
      const env: Record<string, string> = {};
      const code = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS } }).outputText;
      runInNewContext(code, { exports, process: { env }, require(name: string) {
        if (name === 'node:child_process') return { spawnSync: () => {
          calls++; return { status: 0, stdout: '{"class":"feature"}' };
        } };
        if (name === './dedup-resolver.js') return { resolveDedupSidecar: () => 'fixture', resolveSidecarPython: () => 'fixture' };
        throw new Error(`Unexpected import: ${name}`);
      } });
      const priority = exports.classifyTaskRegex('README test') === 'docs';
      exports.classifyTaskSemantic('opaque');
      exports.classifyTaskSemantic('opaque');
      const cached = calls === 1;
      const layered = exports.classifyTask('layered') === 'feature';
      env[exports.CLASSIFIER_DISABLE_ENV] = '1';
      const bypassed = exports.classifyTaskSemantic('opaque') === null;
      return priority && cached && layered && bypassed;
    };
    expect(probe(source)).toBe(true);
    for (const [before, after] of [
      ['of PATTERNS)', 'of [...PATTERNS].reverse())'],
      ['if (cached !== undefined) return cached;', ''],
      ['if (process.env[CLASSIFIER_DISABLE_ENV]) return null;', ''],
      ["return semantic ?? 'other';", "return 'other';"],
    ]) {
      const mutation = source.replace(before, after);
      expect(mutation).not.toBe(source);
      expect(probe(mutation)).toBe(false);
    }
  });

  it.each([
    ['README test fix rename compute build', 'docs'],
    ['test fix rename compute build', 'test'],
    ['fix rename compute build', 'bugfix'],
    ['rename compute build', 'refactor'],
    ['compute build', 'algorithm'],
    ['BUILD', 'feature'],
    ['prefix postfix building', 'other'],
  ])('preserves regex priority and boundaries for %s', (input, expected) => {
    expect(core.classifyTaskRegex(input)).toBe(expected);
    expect(readFileSync(calls, 'utf8')).toBe('');
  });

  it.each(['algorithm', 'refactor', 'bugfix', 'test', 'docs', 'feature', 'other'])('reads and caches valid sidecar output %s', taskClass => {
    expect(core.classifyTaskSemantic(taskClass)).toBe(taskClass);
    expect(core.classifyTaskSemantic(taskClass)).toBe(taskClass);
    const records = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0].args).toHaveLength(1);
    expect(records[0].args[0]).toMatch(/[/\\]classifier\.py$/);
    expect(records[0].input).toEqual({ text: taskClass });
  });

  it.each(['empty', 'malformed', 'exit', 'unknown'])('does not cache sidecar failure %s', input => {
    expect(core.classifyTaskSemantic(input)).toBeNull();
    expect(core.classifyTaskSemantic(input)).toBeNull();
    expect(core.CLASSIFIER_CACHE.has(input)).toBe(false);
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('checks the bypass before the cache and keeps regex work independent', () => {
    core.CLASSIFIER_CACHE.set('cached input', 'feature');
    vi.stubEnv(core.CLASSIFIER_DISABLE_ENV, '0');
    expect(core.classifyTaskSemantic('cached input')).toBeNull();
    expect(core.classifyTask('cached input')).toBe('other');
    expect(core.classifyTask('fix the problem')).toBe('bugfix');
    expect(readFileSync(calls, 'utf8')).toBe('');
  });

  it('uses semantic success for opaque input but skips it for a regex match', () => {
    expect(publicClassify('fix the problem')).toBe('bugfix');
    expect(readFileSync(calls, 'utf8')).toBe('');
    expect(publicClassify('opaque prose')).toBe('feature');
    expect(owner.classifyTask('opaque prose')).toBe('feature');
    expect(core.CLASSIFIER_CACHE.get('opaque prose')).toBe('feature');
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('falls back silently when the executable is missing or times out', () => {
    expect(core.CLASSIFIER_TIMEOUT_MS).toBe(2000);
    const started = performance.now();
    expect(core.classifyTask('stall')).toBe('other');
    expect(performance.now() - started).toBeGreaterThanOrEqual(1900);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(JSON.parse(readFileSync(calls, 'utf8').trim()).input).toEqual({ text: 'stall' });
    expect(core.CLASSIFIER_CACHE.has('stall')).toBe(false);
    vi.stubEnv('AGON_PYTHON', join(root, 'missing'));
    expect(core.classifyTask('unrecognized wording')).toBe('other');
  });
});
