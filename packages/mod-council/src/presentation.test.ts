import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { chairmanPickLabel, councilRunStatus, presentCouncilResult } from './presentation.js';
import type { CouncilResult } from './runtime.js';
import frozenContract from '../../../tests/fixtures/modular-council-command-contract.json';

const instant = '2026-10-24T00:00:00.000Z';
const source = readFileSync(new URL('../../../tests/fixtures/modular-council-command-legacy.txt', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const styles = { bold: (s: string) => `B(${s})`, dim: (s: string) => `D(${s})` };

async function runCommand(result: CouncilResult, args: Record<string, unknown>, commandCode: string) {
  const lines: string[] = [];
  const statuses: unknown[] = [];
  const summaries: unknown[] = [];
  const exports: Record<string, any> = {};
  const process = { cwd: () => '/fixture', exitCode: 0 };
  const modules: Record<string, unknown> = {
    citty: { defineCommand: (command: unknown) => command },
    '@kernlang/agon-core': {
      EngineRegistry: class { load() {} listIds() { return ['alpha', 'beta', 'gamma']; } activeIds() { return this.listIds(); } },
      ensureAgonHome: () => {}, loadConfig: () => ({}), createRunDir: () => ({ path: result.outputDir }),
      writeRunStatus: (_path: string, status: unknown) => statuses.push(status),
      printRunSummary: (status: unknown) => summaries.push(status),
    },
    '../lib/engines-dir.js': { resolveBuiltinEnginesDir: () => '/fixture/engines' },
    '@kernlang/agon-adapter-cli': { createCliAdapter: () => ({}) },
    '@kernlang/agon-forge': { runCouncil: async () => result, joinProblemInput: () => result.question },
    '@kernlang/agon-mod-council': { chairmanPickLabel, councilRunStatus, presentCouncilResult },
    '../blocks/output-format.js': { ...styles, header: () => {}, info: (s: string) => lines.push(s) },
    '../handlers/engine-filter.js': { filterDefaultOrchestrationEngines: (ids: string[]) => ids },
  };
  runInNewContext(commandCode, { exports, process, Date: class extends Date { constructor() { super(instant); } },
    require: (id: string) => { if (!(id in modules)) throw new Error(`Unexpected import ${id}`); return modules[id]; },
    console: { log: (s: string) => lines.push(s), error: () => { throw new Error('Unexpected CLI error'); } },
  });
  expect(JSON.parse(JSON.stringify({ meta: exports.councilCommand.meta, args: exports.councilCommand.args }))).toEqual(frozenContract.command);
  await exports.councilCommand.run({ args: { question: result.question, label: 'fixture', timeout: '73', ...args } });
  if (!args.json && !args.quiet) {
    expect(lines.shift()).toBe(result.question);
    expect(lines.shift()).toBe('');
  }
  return { lines, statuses, summaries, exitCode: process.exitCode };
}

describe('Council frozen CLI presentation and status', () => {
  it('binds the legacy oracle to its archived source hash', () => {
    expect(createHash('sha256').update(source).digest('hex')).toBe(frozenContract.sourceSha256);
  });
  const scenarios: Array<Partial<CouncilResult>> = [
    {}, { actingChairmanId: 'alpha', degraded: true, warnings: ['Chair failed'] },
    { ok: false, verdict: 'No verdict', confidence: null, chairmanId: '', actingChairmanId: '', seats: [], chairmanReason: 'none' },
    { chairmanReason: 'cesar', brief: 'Q', confidence: 0 },
    { chairmanReason: 'forced', confidence: 100 }, { chairmanReason: 'random' },
  ];
  for (const mode of [{ json: false, quiet: false }, { json: false, quiet: true }, { json: true, quiet: false }, { json: true, quiet: true }]) {
    it.each(scenarios)(`preserves raw output and status (${JSON.stringify(mode)}), %j`, async changes => {
      const result: CouncilResult = {
        ok: true, question: 'Q', brief: 'Decision brief', chairmanId: 'gamma', chairmanReason: 'top-rated',
        actingChairmanId: 'gamma', verdict: 'Choose A', confidence: 73, degraded: false,
        warnings: [], outputDir: '/fixture/council', seats: [
          { engineId: 'alpha', role: 'Contrarian', response: 'Objection', critique: 'Fragile assumption', critiquedRole: 'First-Principles' },
          { engineId: 'beta', role: 'First-Principles', response: '(no response)', critique: '', critiquedRole: 'Contrarian' },
        ], ...changes,
      };
      const before = await runCommand(result, mode, code);
      const lines: string[] = [];
      presentCouncilResult(result, mode, { ...styles, header: () => {}, info: s => lines.push(s), log: s => lines.push(s) });
      expect(lines).toEqual(before.lines);
      const status = councilRunStatus(result, { label: 'fixture', startedAt: instant, endedAt: instant,
        requested: ['alpha', 'beta', 'gamma'], timeoutSec: 73 });
      expect(status).toEqual(before.statuses[0]);
      expect(before.summaries).toEqual(mode.json || mode.quiet ? [] : [status]);
      expect(before.exitCode).toBe(result.ok ? 0 : 1);
    });
  }
});
