import ownerConfigSchema from '../schemas/config.schema.json' with { type: 'json' };

// Resource identity is not part of the executable schema subset.
const { $id: _configSchemaId, ...configSchema } = ownerConfigSchema;

import { commandResultToToolResult } from '@kernlang/agon-mod-api';
import type {
  AgonModFactory,
  CommandResult,
  Dispose,
  Json,
  ModServices,
  Registrar,
} from "@kernlang/agon-mod-api";
import { join } from "node:path";
import { redactSecretsDeep, redactSecretsPreservingLines, resolveReviewTarget, reviewMaxDiffChars, type ReviewTarget } from "@kernlang/agon-support-verification";
import { runMutationAssessment } from "@kernlang/agon-support-worktree";
import { buildConsensus } from "./consensus.js";
import { annotateExistingCode, existingCodeReader } from "./existing-code.js";
import { formatReport, formatSummaryLine, parseReviewFormat, type ReviewReport } from "./report.js";
import { mapWithLimit } from "./parallel.js";
import {
  isExplicitPanel, persistRoutingManifest, resolveExplicitPanel, routeReviewPanel,
  routingShortfallMessage, routingSummary, type RoutedPanel,
} from "./panel.js";
import { assignSeatRoles, buildSeatPrompt, gatherReviewPromptContext } from "./prompt.js";
import { runSeat } from "./seat.js";
import { runSplitReview } from "./split.js";
const schema = Object.freeze({
  type: "object",
  additionalProperties: true,
  properties: {
    target: { type: "string", default: "uncommitted" },
    base: { type: "string" },
    engine: { type: "string" },
    engines: { type: "string" },
    risk: { type: "string", default: "auto" },
    "primary-engine": { type: "string" },
    roles: { type: "string" },
    label: { type: "string" },
    quiet: { type: "boolean" },
    timeout: { type: "string" },
    deadline: { type: "string" },
    format: { type: "string", default: "json" },
    maxParallel: { type: "string" },
    "max-diff-chars": { type: "string" },
    split: { type: "boolean" },
    "max-batches": { type: "string" },
    mutate: { type: "boolean" },
    "mutate-semantic": { type: "boolean" },
    "mutate-test": { type: "string" },
    "mutate-build": { type: "string" },
    "mutate-lens": { type: "string" },
    verbose: { type: "boolean" },
    _: { type: "array", items: { type: "string" } },
  },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({
  positionals: ["target"],
  aliases: { engines: "e", maxParallel: "p", verbose: "v" },
  ttyDefaults: { format: "text" },
  descriptions: {
    target: "uncommitted, branch:NAME, commit:SHA, or range:BASE...TARGET",
    base: "Explicit diff base ref. With \"uncommitted\": diff working tree vs BASE. With \"branch:NAME\": diff BASE...NAME (checkout-independent).",
    engine: "Use one specific engine and bypass automatic risk routing",
    engines: "Use a strict explicit engine subset and bypass automatic risk routing; invalid or unavailable entries abort rather than silently shrinking it",
    risk: "Automatic routing risk: auto, low, medium, or high. Sensitive diff evidence can only raise the requested risk. Ignored with --engine/--engines.",
    "primary-engine": "Engine that implemented the diff. Automatic routing excludes its adapter identity from required independent review seats; omission widens to high risk.",
    roles: "Role-lens review (same panel, focused attention): 'auto' deals the fixed roster (security, correctness, dryness, performance, overall) onto the selected engines in order with an overall backstop for extras, or pass a comma-separated role list zipped engine-by-engine (unknown ids fall back to overall). Composes with automatic risk routing — roles change each reviewer's lens, never the panel or the machine contract.",
    label: "Human-readable suffix baked into the run dir name.",
    quiet: "Print only the run dir path and final summary on stdout (SARIF output is unaffected). Per-engine output is still written to <run-dir>/<engineId>-output.txt.",
    timeout: "Per-engine hard wall-clock timeout in seconds. When an engine exceeds it its dispatch is aborted and marked timeout; other engines are unaffected. Default: config.reviewTimeout or 420.",
    "max-diff-chars": "Largest diff to review, in characters. Default: config.reviewMaxDiffChars or 100000. Over the limit, review refuses before spending anything and lists the files reviewers would miss; it never reviews part of a diff. Engines still have their own limits: a CLI without stdin delivery takes its prompt as a process argument, and every prompt must fit the model's context, so a seat that cannot take the diff fails visibly.",
    split: "When the diff is over the limit, review it in per-file batches at or under the limit with the normal panel, merge the findings into one report and exit 1 if any batch failed or was skipped (blockers stay in the report), else the worst batch result. Risk is resolved once from the whole diff for every batch. If a whole batch fails, the remaining batches are skipped. Cross-file issues between batches may be missed; the report says so. A single file over the limit still refuses, by name. Cannot be combined with --mutate: run agon mutate --diff <target> separately.",
    "max-batches": "With --split: most batches to run (default 10). Each batch spends a full panel, so a plan over the limit refuses before any spend and names the batch count.",
    maxParallel: "Max engines to review concurrently. Default: all at once. Lower it (e.g. 2) if parallel API engines hit rate limits or first-chunk stalls.",
    mutate: "ADVISORY mutation pass after the consensus: mutate the reviewed diff in a disposable worktree, re-run the discovered test command per mutant, and list every SURVIVOR (wrong code the tests called green). Mechanical-only (zero engine spend) unless --mutate-semantic; artifacts land in <run-dir>/mutation/; never changes the review verdict or exit code.",
    "mutate-semantic": "With --mutate: also let the reviewing engines propose AI-semantic mutants — real engine spend, and your changed source is sent to each of them. Off by default, exactly like agon mutate.",
    "mutate-test": "With --mutate: the test command to run per mutant, instead of the discovered gate. Use it when the discovered script is not the suite that covers the diff.",
    "mutate-build": "With --mutate: build command run before the baseline AND each mutant — required when the suite runs against a prebuilt dist rather than the mutated source (otherwise every mutant survives).",
    "mutate-lens": "With --mutate: steer the AI-semantic panel toward one bug family — IMPLIES --mutate-semantic. Presets: security | privacy | perf | ratelimit | concurrency; anything else is used verbatim as free text.",
    verbose: "With text output: after the consensus summary, print each engine's FULL review inline (the raw walls). Without it, full reviews stay in the run dir (the pointer line is always printed).",
    format: "Output format: text, json or sarif. Default: text in a terminal, json when piped",
    deadline: "Overall review deadline in seconds; seats still running when it expires are stopped",
  },
});
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const cesarSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    target: { type: "string" },
    engine: { type: "string" },
    engines: { type: "array", items: { type: "string" } },
  },
}) as Readonly<Record<string, Json>>;
const seconds = (raw: Json | undefined): number | null | undefined => {
  if (!text(raw)) return undefined;
  const value = Number(text(raw));
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
};
export async function runReview(
  raw: Json,
  context: Parameters<ModServices["engines"]["dispatch"]>[2],
  services: ModServices,
  evidence: { readonly mutationEvidence?: string; readonly batch?: ReviewTarget } = {},
): Promise<CommandResult> {
  const input = raw as Record<string, Json>;
  const format = parseReviewFormat(input.format);
  if (!format) return { exitCode: 1, stderr: 'Unknown review format. Use json, text, or sarif.\n' };
  const maxDiffChars = seconds(input["max-diff-chars"]);
  if (maxDiffChars === null) return { exitCode: 1, stderr: 'Review max-diff-chars must be a positive integer.\n' };
  let target = evidence.batch;
  if (!target) {
    try {
      const limit = maxDiffChars ?? reviewMaxDiffChars(context.config);
      const split = input.split === true;
      const resolved = resolveReviewTarget(
        text(input.target) || "uncommitted",
        context.cwd,
        text(input.base) || undefined,
        split ? Number.POSITIVE_INFINITY : limit,
        "--max-diff-chars",
      );
      if (split && resolved.diff.length > limit) {
        return await runSplitReview(resolved, limit, input, format, context, services,
          (batch, batchInput) => runReview(batchInput, context, services, { ...evidence, batch }));
      }
      target = { ...resolved, maxDiffChars: limit };
    } catch (error) {
      return {
        exitCode: 1,
        stderr: `${error instanceof Error ? error.message : String(error)}\n`,
      };
    }
  }
  const explicit = isExplicitPanel(input);
  let engines: string[] = [];
  if (explicit) {
    const resolved = await resolveExplicitPanel(input, context, services);
    if (!Array.isArray(resolved)) return { exitCode: 1, stderr: `${resolved.error}\n` };
    engines = resolved;
  }
  if (!target.diff.trim()) {
    const empty = { target: target.label, reviews: [], findings: [] };
    return {
      exitCode: 0,
      stdout: format === 'sarif' || (format === 'json' && text(input.format)) ? formatReport(empty, format) : `No diff found for ${target.label}.\n`,
      result: empty as Json,
    };
  }
  let routed: RoutedPanel | undefined;
  if (!explicit) {
    const panel = await routeReviewPanel(input, target.diff, context, services);
    if (!("engines" in panel)) return { exitCode: 1, stderr: `${panel.error}\n` };
    routed = panel;
    engines = panel.engines;
  }
  if (!engines.length && !(routed?.identitiesVerifiable && routed.manifest.shortfall))
    return { exitCode: 1, stderr: "No active engines available for review.\n" };
  const timeoutSeconds = seconds(input.timeout);
  if (timeoutSeconds === null) {
    return { exitCode: 1, stderr: 'Review timeout must be a positive integer in seconds.\n' };
  }
  const deadlineSeconds = seconds(input.deadline);
  if (deadlineSeconds === null) {
    return { exitCode: 1, stderr: 'Review deadline must be a positive integer in seconds.\n' };
  }
  const maxParallel = seconds(input.maxParallel);
  if (maxParallel === null) {
    return { exitCode: 1, stderr: 'Review maxParallel must be a positive integer.\n' };
  }
  const deadline = { startedAtMs: Date.now(), ...(deadlineSeconds !== undefined ? { seconds: deadlineSeconds } : {}), now: () => Date.now(), seatCeilingsSeconds: [] };
  const run = await services.runs?.start("review", text(input.label) || undefined, context);
  const manifestPath = routed ? await persistRoutingManifest(run, routed, context, services) : undefined;
  const shortfall = routed ? routingShortfallMessage(routed) : undefined;
  if (routed && shortfall && routed.identitiesVerifiable) {
    if (run)
      await services.runs?.finish(run, {
        mode: "review", startedAt: run.startedAt, endedAt: new Date().toISOString(), engines: [],
        requested: engines, timeoutSec: timeoutSeconds ?? null, summary: shortfall, ok: false,
      }, context);
    return {
      exitCode: 1,
      stderr: `${shortfall}.${manifestPath ? ` Routing manifest: ${manifestPath}` : ""}\n`,
      result: { target: target.label, routing: routingSummary(routed, manifestPath), reviews: [], findings: [] } as Json,
    };
  }
  const mutationEvidence = redactSecretsPreservingLines(evidence.mutationEvidence?.trim() ?? "");
  if (run && mutationEvidence) {
    await services.runs!.writeArtifact(run, 'mutation-evidence.txt', mutationEvidence, context);
  }
  const roles = assignSeatRoles(engines, input.roles);
  const grounding = redactSecretsDeep(await gatherReviewPromptContext(target.diff, context, services));
  const diff = redactSecretsPreservingLines(target.diff);
  const seatTimeout = timeoutSeconds !== undefined && deadlineSeconds !== undefined
    ? Math.min(timeoutSeconds, deadlineSeconds) : timeoutSeconds;
  const seats = await mapWithLimit(engines, maxParallel, (engineId) => runSeat({
      engineId,
      ...(roles.has(engineId) ? { role: roles.get(engineId) } : {}),
      prompt: buildSeatPrompt({ label: target.label, diff, roleId: roles.get(engineId), mutationEvidence }, grounding),
      ...(seatTimeout !== undefined ? { timeoutSeconds: seatTimeout } : {}),
      ...(deadlineSeconds !== undefined ? { maxWallSeconds: deadlineSeconds } : {}),
      deadline,
    }, context, services));
  const quoteSource = existingCodeReader((text(input.target) || "uncommitted") === "uncommitted" ? { cwd: context.cwd } : { diff });
  const reviews = seats.map((seat) => seat.ok ? { ...seat, findings: annotateExistingCode(seat.findings, quoteSource) } : seat);
  const usable = reviews.filter((r) => r.ok);
  if (run)
    await Promise.all(
      reviews.map((review) =>
        services.runs!.writeArtifact(
          run,
          `${review.engineId}-output.txt`,
          redactSecretsPreservingLines(review.output || `No review output.\nReason: ${review.status}: ${review.error}\n`),
          context,
        ),
      ),
    );
  const findings = usable
    .flatMap((r) => r.findings)
    .sort(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) || b.confidence - a.confidence,
    );
  const consensus = buildConsensus(reviews.map((review) => ({
    engine: review.engineId,
    status: review.ok ? 'ok' : review.status,
    findings: review.ok ? review.findings.map((finding) => ({ ...finding, engine: review.engineId })) : [],
    ...(review.ok && !review.partial ? {} : { note: review.error }),
  })));
  const warnings: string[] = [...(routed?.warnings ?? [])];
  if (shortfall) warnings.push(shortfall);
  if (consensus.degraded) warnings.push(consensus.degraded.warning);
  const result: Record<string, unknown> = {
    target: target.label,
    diffSize: { chars: target.diff.length, maxChars: target.maxDiffChars },
    ...(mutationEvidence ? { mutationEvidence } : {}),
    engines,
    roles: Object.fromEntries(roles),
    ...(routed ? { routing: routingSummary(routed, manifestPath) } : {}),
    reviews,
    findings,
    consensus,
    panelHealth: {
      requested: engines.length,
      responded: usable.length,
      degraded: usable.length !== engines.length,
    },
  };
  const mutationOverridesPresent =
    input["mutate-semantic"] === true ||
    Boolean(text(input["mutate-test"])) ||
    Boolean(text(input["mutate-build"])) ||
    Boolean(text(input["mutate-lens"]));
  if (input.mutate === true) {
    if (!run) {
      result.mutation = {
        ok: false,
        skipped: true,
        advisory: true,
        error: "durable run storage is unavailable on this host",
      };
    } else {
      try {
        result.mutation = await runMutationAssessment(
          {
            repoRoot: context.cwd,
            diff: target.diff,
            outputDir: join(run.path, "mutation"),
            engines,
            semantic:
              input["mutate-semantic"] === true ||
              Boolean(text(input["mutate-lens"])),
            testCmd: text(input["mutate-test"]) || undefined,
            buildCmd: text(input["mutate-build"]) || undefined,
            lens: text(input["mutate-lens"]) || undefined,
          },
          context,
          {
            engines: services.engines,
            recordReceipt: (kind, payload) =>
              services.receipts.record(kind, payload as Json),
          },
        );
      } catch (error) {
        result.mutation = {
          ok: false,
          skipped: true,
          advisory: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  } else if (mutationOverridesPresent) {
    warnings.push(
      "--mutate-semantic/--mutate-test/--mutate-build/--mutate-lens have no effect without --mutate; no mutation pass ran.",
    );
  }
  if (warnings.length) result.warnings = warnings;
  if (run) result.runDir = run.path;
  await services.receipts.record("review", {
    target: target.label,
    requested: engines.length,
    responded: usable.length,
    blocking: consensus.blockers.length,
  });
  const exitCode = usable.length ? (consensus.blockers.length ? 2 : 0) : 1;
  const report = redactSecretsDeep(result);
  if (run) {
    await services.runs!.writeArtifact(run, 'diff.patch', diff, context);
    await services.runs!.writeArtifact(run, 'report.json', `${JSON.stringify(report, null, 2)}\n`, context);
  }
  if (run)
    await services.runs?.finish(
      run,
      {
        mode: "review",
        startedAt: run.startedAt,
        endedAt: new Date().toISOString(),
        engines: reviews.map((review) => ({
          id: review.engineId,
          status: review.status,
          detail: review.error || null,
        })),
        requested: engines,
        timeoutSec: timeoutSeconds ?? (Math.max(0, ...reviews.map((review) => review.timeoutSeconds ?? 0)) || null),
        summary: `${usable.length}/${engines.length} reviewers produced machine-readable evidence`,
        ok: exitCode === 0,
      },
      context,
    );
  return {
    exitCode,
    stdout: input.quiet === true && format !== 'sarif'
      ? `${run ? `${run.path}\n` : ''}${formatSummaryLine(report as unknown as ReviewReport)}\n`
      : formatReport(report as unknown as ReviewReport, format, { verbose: input.verbose === true }),
    result: report as unknown as Json,
  };
}
function parseReviewIntent(input: string) {
  if (!/^\/(?:review|cr)(?:\s|$)/i.test(input)) return undefined;
  const parts = input
      .replace(/^\/(?:review|cr)\s*/i, "")
      .split(/[\s,]+/)
      .filter(Boolean),
    knownRoles = new Set([
      "security",
      "correctness",
      "dryness",
      "performance",
      "overall",
    ]),
    engineIds: string[] = [],
    roles: string[] = [];
  let target: string | undefined,
    index = 0,
    roleMode = false;
  if (/^(?:role|roles)$/i.test(parts[0] ?? "")) {
    roleMode = true;
    index = 1;
    while (index < parts.length && knownRoles.has(parts[index].toLowerCase()))
      roles.push(parts[index++].toLowerCase());
  }
  for (; index < parts.length; index += 1) {
    const part = parts[index],
      lower = part.toLowerCase();
    if (
      ["and", "or", "plus", "with"].includes(lower) ||
      ["it", "this", "that", "them", "changes", "diff"].includes(lower)
    )
      continue;
    if (
      lower === "uncommitted" ||
      lower.startsWith("branch:") ||
      lower.startsWith("commit:") ||
      lower.startsWith("range:")
    ) {
      target ??= part;
      continue;
    }
    if (!engineIds.includes(lower)) engineIds.push(lower);
  }
  return {
    ...(roleMode ? { type: "review-role" } : {}),
    ...(engineIds.length ? { engineId: engineIds[0], engineIds } : {}),
    ...(target ? { target } : {}),
    ...(roles.length ? { roles } : {}),
  };
}
export const createMod: AgonModFactory = (services) =>
  Object.freeze({
    apiVersion: "1" as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const d: Dispose[] = [];
      const command = {
        description:
          "Run a non-interactive evidence-grounded review of a Git diff",
        inputSchema: schema,
        cli,
        run: (input: Json, context: any) => runReview(input, context, services),
      };
      d.push(registrar.command("cli", { id: "cliCommands:0063", ...command }));
      d.push(
        registrar.intent({
          id: "intentVariants:0051",
          description: "Parse review intent",
          inputSchema: schema,
          parse: parseReviewIntent,
          run: (input, context) => {
            const parsed = input as Record<string, Json>;
            return runReview({
              ...(typeof parsed.target === 'string' ? { target: parsed.target } : {}),
              ...(Array.isArray(parsed.engineIds) ? { engines: parsed.engineIds.join(',') }
                : typeof parsed.engineId === 'string' ? { engine: parsed.engineId } : {}),
              ...(Array.isArray(parsed.roles) ? { roles: parsed.roles.join(',') } : {}),
            }, context, services);
          },
        }),
      );
      for (const id of [
        "builtinCommandMetadata:0040",
        "tuiSlashCommands:0057",
        "tuiSlashCommands:0058",
      ])
        d.push(registrar.command("tui", { id, ...command }));
      d.push(
        registrar.tool("mcp", {
          id: "mcpTools:0021",
          description: "Review a Git diff",
          inputSchema: schema,
          effect: "process",
          run: async (input, context) =>
            commandResultToToolResult(await runReview(input, context, services)),
        }),
      );
      for (const id of [
        "cesarRoutes:0042",
        "cesarRoutes:0043",
        "cesarRoutes:0044",
        "cesarRoutes:0045",
        "cesarRoutes:0046",
        "cesarRoutes:0047",
      ])
        d.push(
          registrar.planStep({
            id,
            inputSchema: schema,
            resultSchema: schema,
            risk: "read",
            run: (input, context) => runReview(input, context, services),
          }),
        );
      d.push(
        registrar.tool("cesar", {
          id: "cesarTools:0023",
          description:
            "Hand the selected diff to the read-only Review workflow",
          inputSchema: cesarSchema,
          effect: "read",
          run: async () =>
            "Delegation accepted — end your turn now so the run can start.",
        }),
      );
      for (const id of [
        "resultAndEnvelopeTypes:0107",
        "resultAndEnvelopeTypes:0108",
      ])
        d.push(
          registrar.resultType({
            id,
            schema: { type: "object", additionalProperties: true },
            readableVersions: ">=0.2.0",
            render: async (payload) => ({
              text: JSON.stringify(payload, null, 2),
            }),
          }),
        );
      for (const id of ["configKeys:0007", "configKeys:0087", "configKeys:0110"])
        d.push(
          registrar.config(id, configSchema),
        );
      return async () => {
        for (const x of [...d].reverse()) await x();
      };
    },
  });
export default createMod;
