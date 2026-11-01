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
import { resolveReviewTarget } from "@kernlang/agon-support-verification";
import { runMutationAssessment } from "@kernlang/agon-support-worktree";
import { buildConsensus } from "./consensus.js";
import {
  isExplicitPanel, persistRoutingManifest, resolveExplicitPanel, routeReviewPanel,
  routingShortfallMessage, routingSummary, type RoutedPanel,
} from "./panel.js";
import { assignSeatRoles, buildSeatPrompt, gatherReviewPromptContext } from "./prompt.js";
import { runSeat } from "./seat.js";
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
    maxParallel: { type: "string" },
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
  descriptions: {
    target: "uncommitted, branch:NAME, commit:SHA, or range:BASE...TARGET",
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
  evidence: { readonly mutationEvidence?: string } = {},
): Promise<CommandResult> {
  const input = raw as Record<string, Json>;
  let target;
  try {
    target = resolveReviewTarget(
      text(input.target) || "uncommitted",
      context.cwd,
      text(input.base) || undefined,
    );
  } catch (error) {
    return {
      exitCode: 1,
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
  const explicit = isExplicitPanel(input);
  let engines: string[] = [];
  if (explicit) {
    const resolved = await resolveExplicitPanel(input, context, services);
    if (!Array.isArray(resolved)) return { exitCode: 1, stderr: `${resolved.error}\n` };
    engines = resolved;
  }
  if (!target.diff.trim())
    return {
      exitCode: 0,
      stdout: `No diff found for ${target.label}.\n`,
      result: { target: target.label, reviews: [], findings: [] } as Json,
    };
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
  const mutationEvidence = evidence.mutationEvidence?.trim();
  if (run && mutationEvidence) {
    await services.runs!.writeArtifact(run, 'mutation-evidence.txt', mutationEvidence, context);
  }
  const roles = assignSeatRoles(engines, input.roles);
  const grounding = await gatherReviewPromptContext(target.diff, context, services);
  const seatTimeout = timeoutSeconds !== undefined && deadlineSeconds !== undefined
    ? Math.min(timeoutSeconds, deadlineSeconds) : timeoutSeconds;
  const reviews = await Promise.all(
    engines.map((engineId) => runSeat({
      engineId,
      ...(roles.has(engineId) ? { role: roles.get(engineId) } : {}),
      prompt: buildSeatPrompt({ label: target.label, diff: target.diff, roleId: roles.get(engineId), mutationEvidence }, grounding),
      ...(seatTimeout !== undefined ? { timeoutSeconds: seatTimeout } : {}),
      ...(deadlineSeconds !== undefined ? { maxWallSeconds: deadlineSeconds } : {}),
      deadline,
    }, context, services)),
  );
  const usable = reviews.filter((r) => r.ok);
  if (run)
    await Promise.all(
      reviews.map((review) =>
        services.runs!.writeArtifact(
          run,
          `${review.engineId}-output.txt`,
          review.output || `No review output.\nReason: ${review.status}: ${review.error}\n`,
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
    stdout: `${JSON.stringify(result, null, 2)}\n`,
    result: result as unknown as Json,
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
      for (const id of ["configKeys:0007", "configKeys:0087"])
        d.push(
          registrar.config(id, configSchema),
        );
      return async () => {
        for (const x of [...d].reverse()) await x();
      };
    },
  });
export default createMod;
