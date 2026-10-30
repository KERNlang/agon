import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { presentSynthesisResult, synthesisRunStatus } from './presentation.js';
import type { SynthesisResult } from './runtime.js';

const legacy = readFileSync(new URL('../../../tests/fixtures/modular-synthesis-command-legacy.txt', import.meta.url), 'utf8');
const current = readFileSync(new URL('../../cli/src/commands/synthesis.ts', import.meta.url), 'utf8');
const instant = '2026-10-28T00:00:00.000Z';

async function capture(source: string, result: SynthesisResult, quiet: boolean, environmentQuiet: boolean) {
  const events: unknown[] = [];
  const exports: Record<string, any> = {};
  const output = {
    header: (text: string) => events.push(['header', text]),
    info: (text: string) => events.push(['info', text]),
    table: (headers: string[], rows: string[][]) => events.push(['table', headers, rows]),
    bold: (text: string) => `B(${text})`, green: (text: string) => `G(${text})`, dim: (text: string) => `D(${text})`,
    warn: (text: string) => events.push(['warn', text]), fail: () => { throw new Error('Unexpected failure'); },
  };
  const modules: Record<string, unknown> = {
    citty: { defineCommand: (value: unknown) => value },
    '@kernlang/agon-core': {
      EngineRegistry: class { load() {} activeIds() { return ['alpha', 'beta']; } partitionRoster() { return { removed: [] }; } },
      ensureAgonHome: () => {}, loadConfig: () => ({}),
      createRunDir: () => ({ path: '/fixture/run' }),
      writeRunStatus: (_path: string, status: unknown) => events.push(['status', status]),
      printRunSummary: (status: unknown) => events.push(['summary', status]),
    },
    '@kernlang/agon-adapter-cli': { createCliAdapter: () => ({}) },
    '@kernlang/agon-forge': { runSynthesisModus: async () => result, synthesisRoutingAdvice: () => 'fixture advice' },
    '@kernlang/agon-mod-synthesis': { presentSynthesisResult, synthesisRunStatus },
    '../lib/engines-dir.js': { resolveBuiltinEnginesDir: () => '/fixture/engines' },
    '../handlers/engine-filter.js': { filterDefaultOrchestrationEngines: (ids: string[]) => ids },
    '../blocks/output-format.js': output,
  };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, {
    exports, require: (name: string) => { if (!(name in modules)) throw new Error(`Unexpected import ${name}`); return modules[name]; },
    console: { log: (text: string) => events.push(['log', text]) },
    process: { cwd: () => '/fixture', env: environmentQuiet ? { AGON_QUIET: '1' } : {}, exit: () => { throw new Error('Unexpected exit'); } },
    Date: class extends Date { constructor() { super(instant); } },
  });
  await exports.synthesisCommand.run({ args: { prompt: 'Design fixture', swaps: '1', timeout: '120', label: 'fixture', quiet } });
  return JSON.parse(JSON.stringify(events));
}

describe('Synthesis frozen legacy report', () => {
  it('binds the oracle to exact pre-extraction source', () => {
    expect(createHash('sha256').update(legacy).digest('hex')).toBe('0a26646c71266f042bfe14bed07a02e0ec3d39047f629055364556774dcb2842');
  });
  for (const [quiet, environmentQuiet] of [[false, false], [true, false], [false, true]]) {
    it.each(['full', 'empty', 'failed', 'short', 'missing-score-fields'])(`preserves output and status: quiet=${quiet}, env=${environmentQuiet}, %s`, async scenario => {
      const result: SynthesisResult = {
        prompt: 'Design fixture', winner: 'alpha', judgeReasoning: 'fixture',
        drafts: [{ engineId: 'alpha', content: 'x'.repeat(401), round: 0 }],
        swaps: [{ round: 1, fromEngineId: 'beta', toEngineId: 'alpha', originalContent: 'old', improvedContent: 'new', reasoning: 'r'.repeat(61) }],
        scores: [{ engineId: 'alpha', score: 90, confidence: 0.75, unhandled: 'u'.repeat(49) }],
      };
      if (scenario === 'empty') { result.drafts = []; result.swaps = []; result.scores = []; }
      if (scenario === 'failed') result.drafts[0].content = '[draft failed: fixture]';
      if (scenario === 'short') result.drafts[0].content = 'short';
      if (scenario === 'missing-score-fields') result.scores = [{ engineId: 'beta', score: 0 }];
      expect(await capture(current, result, quiet, environmentQuiet)).toEqual(await capture(legacy, result, quiet, environmentQuiet));
    });
  }
});
