import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgonModFactory, CommandResult, Dispose, InvocationContext, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import {
  generateMechanicalMutants,
  generateSemanticMutationCandidates,
  runMutationAssessment,
  type MutationCandidate,
} from '@kernlang/agon-support-worktree';

const schema = Object.freeze({
  type: 'object',
  additionalProperties: true,
  properties: {
    path: { type: 'string' },
    diff: { type: 'string' },
    base: { type: 'string' },
    test: { type: 'string' },
    typecheck: { type: 'string' },
    build: { type: 'string' },
    semantic: { type: 'boolean', default: false },
    'mechanical-only': { type: 'boolean', default: false },
    engines: { type: 'string' },
    lens: { type: 'string' },
    'max-mutants': { type: 'string', default: '40' },
    'semantic-per-engine': { type: 'string', default: '8' },
    timeout: { type: 'string', default: '120' },
    budget: { type: 'string', default: '900' },
    json: { type: 'boolean', default: false },
    label: { type: 'string' },
    quiet: { type: 'boolean', default: false },
    _: { type: 'array', items: { type: 'string' } },
  },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({
  positionals: ['path'],
  aliases: { engines: 'e' },
  descriptions: { path: 'File or directory to mutate' },
});

function values(raw: Json): Record<string, Json> { return raw as Record<string, Json>; }
function targetOf(input: Record<string, Json>): string {
  return String(input.path ?? (Array.isArray(input._) ? input._[0] : '') ?? '').trim();
}
function numberOption(input: Record<string, Json>, camel: string, kebab: string, fallback: number): number {
  const parsed = Number(input[camel] ?? input[kebab] ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function generateMutants(source: string, file: string): MutationCandidate[] {
  return generateMechanicalMutants(source, file);
}

export async function generateSemanticMutants(
  source: string,
  file: string,
  lens: string,
  services: ModServices,
  context: InvocationContext,
  limit: number,
): Promise<MutationCandidate[]> {
  const generated = await generateSemanticMutationCandidates(
    file,
    source,
    [...await services.engines.listActive?.(context) ?? []],
    limit,
    context,
    services.engines,
    lens,
  );
  return generated.mutants;
}

async function executeMutation(raw: Json, context: InvocationContext, services: ModServices, forceSemantic = false): Promise<CommandResult> {
  const input = values(raw);
  const mechanicalOnly = input['mechanical-only'] === true || input.mechanicalOnly === true;
  if ((forceSemantic || input.semantic === true) && mechanicalOnly)
    return { exitCode: 1, stderr: 'Pass --semantic OR --mechanical-only, not both — --semantic forces the AI-semantic panel on, --mechanical-only is the (default) mechanical run.\n' };
  const target = targetOf(input);
  const diffArg = String(input.diff ?? '').trim();
  const baseArg = String(input.base ?? '').trim();
  const lens = String(input.lens ?? '').trim();
  if (lens && mechanicalOnly)
    return { exitCode: 1, stderr: 'Pass --lens OR --mechanical-only, not both — a lens steers the AI-semantic panel (so it implies --semantic), and --mechanical-only turns that panel off.\n' };
  if (target && diffArg) return { exitCode: 1, stderr: 'Pass a path OR --diff, not both — a path mutates whole files, --diff mutates changed lines.\n' };
  if (target && baseArg) return { exitCode: 1, stderr: 'Pass a path OR --base, not both — a path mutates whole files, --base only resolves which changed lines to mutate.\n' };
  const testCmd = String(input.test ?? '').trim();
  let diff: string | undefined;
  if (!target) {
    const ref = diffArg && !/^(?:uncommitted|branch:|commit:|range:)/.test(diffArg) ? diffArg : baseArg;
    try {
      diff = execFileSync('git', ['diff', '--binary', ref || 'HEAD'], { cwd: context.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      return { exitCode: 1, stderr: `Unable to resolve mutation diff: ${error instanceof Error ? error.message : String(error)}\n` };
    }
    if (!diff.trim()) return { exitCode: 1, stderr: 'No changed lines to mutate. Pass a path to mutate whole files, or --diff <base>.\n' };
  }

  const run = await services.runs?.start('mutate', target, context);
  const outputDir = run ? join(run.path, 'mutation') : mkdtempSync(join(tmpdir(), 'agon-mutate-report-'));
  const semantic = forceSemantic || input.semantic === true || Boolean(lens);
  const requestedEngines = typeof input.engines === 'string'
    ? input.engines.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const assessment = await runMutationAssessment({
    repoRoot: context.cwd,
    ...(target ? { files: [target] } : { diff }),
    testCmd: testCmd || undefined,
    buildCmd: String(input.build ?? '').trim() || undefined,
    typecheckCmd: String(input.typecheck ?? '').trim() || undefined,
    semantic,
    lens: lens || undefined,
    engines: requestedEngines,
    maxMutants: Math.max(1, Math.min(500, numberOption(input, 'maxMutants', 'max-mutants', 40))),
    semanticPerEngine: Math.max(1, numberOption(input, 'semanticPerEngine', 'semantic-per-engine', 8)),
    perMutantTimeoutSec: Math.max(1, numberOption(input, 'perMutantTimeout', 'timeout', 30)),
    totalBudgetSec: Math.max(1, numberOption(input, 'totalBudget', 'budget', 600)),
    outputDir,
  }, context, {
    engines: services.engines,
    recordReceipt: (kind, payload) => services.receipts.record(kind, payload as Json),
  });

  const report = (assessment.report ?? {}) as Record<string, unknown>;
  if (run) await services.runs?.finish(run, { ok: assessment.ok === true, report: report as Json }, context);
  if (assessment.ok !== true) {
    const baselineRed = assessment.error === 'tests are red before mutation';
    return {
      exitCode: 1,
      stderr: `${String(assessment.error ?? 'Mutation assessment failed')}\n`,
      ...(baselineRed ? { failure: { code: 'MUTATE_BASELINE_RED', message: 'Baseline must pass', retryable: false } } : {}),
      result: assessment as Json,
    };
  }
  const result = { ...report, semantic, engineCalls: assessment.engineCalls, outputDir, receiptId: assessment.receiptId } as Json;
  return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, result };
}

export async function runMutate(raw: Json, context: InvocationContext, services: ModServices): Promise<CommandResult> {
  return executeMutation(raw, context, services, false);
}

export async function runSemanticMutate(raw: Json, context: InvocationContext, services: ModServices): Promise<CommandResult> {
  return executeMutation(raw, context, services, true);
}

export const createMod: AgonModFactory = (services) => Object.freeze({
  apiVersion: '1' as const,
  async activate(registrar: Registrar): Promise<Dispose> {
    const command = { description: 'Measure test strength with isolated mechanical or semantic mutants', inputSchema: schema, cli,
      run: (input: Json, context: InvocationContext) => runMutate(input, context, services) };
    const disposers = [
      registrar.command('cli', { id: 'cliCommands:0054', ...command }),
      registrar.command('tui', { id: 'tuiSlashCommands:0045', ...command, parse: (value: string) => ({ input: value.replace(/^\/mutate\s*/i, '') }) }),
      registrar.config('configKeys:0041', { type: 'object', additionalProperties: true }),
    ];
    return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
  },
});

export default createMod;
