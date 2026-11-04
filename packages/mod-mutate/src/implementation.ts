import ownerConfigSchema from '../schemas/config.schema.json' with { type: 'json' };

// Resource identity is not part of the executable schema subset.
const { $id: _configSchemaId, ...configSchema } = ownerConfigSchema;

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
  descriptions: { path: 'File or directory to mutate' ,
    diff: "Mutate changed lines only: a base ref (origin/main), or a review target — uncommitted, branch:NAME, commit:SHA, range:BASE...TARGET.",
    base: "Explicit diff base ref, composed with --diff uncommitted / --diff branch:NAME (same grammar as agon review --base).",
    test: "Test command to run per mutant. Required when no test script can be discovered — mutate never guesses a gate.",
    typecheck: "Typecheck/compile command; a mutant that fails it is classified invalid and excluded from the score.",
    build: "Build command run before the baseline AND before each mutant — needed when the suite runs against a prebuilt dist rather than the mutated source.",
    semantic: "Add the AI-semantic panel: every engine on the roster proposes a realistic bug it thinks your tests would miss. OFF by default — it sends your changed source to every panel engine and spends 1-2 dispatches each. The default run is mechanical-only and costs nothing.",
    "mechanical-only": "Mechanical operators only, zero engine spend. This is the DEFAULT — the flag exists to say so explicitly (and to make --semantic --mechanical-only fail as the contradiction it is).",
    engines: "Restrict the semantic panel (comma-separated). Only meaningful with --semantic; the default mechanical run dispatches no engine at all.",
    lens: "Steer the AI-semantic panel toward one bug family — IMPLIES --semantic (a lens cannot focus mechanical operators). Presets: security (auth bypass, missing permission/ownership checks, token/session misuse, removed input validation) · privacy (returning/logging more user data than needed, PII leaks, missing redaction) · perf (N+1, missing cache/index, unbounded loops, missing pagination/limits) · ratelimit (skipped/loosened throttles, quota checks, retry storms) · concurrency (lost locks, races, non-atomic read-modify-write). Anything else is used verbatim as free text.",
    "max-mutants": "Cap the mutant pool (high-signal first, round-robin across files).",
    "semantic-per-engine": "Max semantic mutants accepted per engine.",
    timeout: "Per-mutant test timeout in seconds (raised to 3x the measured baseline when that is longer).",
    budget: "Total wall-clock budget in seconds; unrun mutants are reported as not-run, never as killed.",
    json: "Emit ONLY the MutationReport as JSON on stdout.",
    label: "Human-readable suffix baked into the run dir name.",
    quiet: "Suppress per-mutant progress; print only the final report.",
  },
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
    const detail = typeof report.baselineError === 'string' && report.baselineError !== assessment.error
      ? `\n${report.baselineError}` : '';
    return {
      exitCode: 1,
      stderr: `${String(assessment.error ?? 'Mutation assessment failed')}${detail}\n`,
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
      registrar.config('configKeys:0041', configSchema),
    ];
    for (const id of ['resultAndEnvelopeTypes:0083', 'resultAndEnvelopeTypes:0114']) disposers.push(registrar.resultType({ id, schema: { type: 'object', additionalProperties: true }, readableVersions: '>=0.2.0', render: async (payload) => ({ text: JSON.stringify(payload, null, 2) }) }));
    return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
  },
});

export default createMod;
