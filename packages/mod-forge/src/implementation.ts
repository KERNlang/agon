import { commandResultToToolResult } from '@kernlang/agon-mod-api';
import type { AgonModFactory, Dispose, InvocationContext, Json, Registrar } from '@kernlang/agon-mod-api';
import { applyInputSchema, parseApply, runApply } from './apply.js';
import { runForgeCompetition } from './competition.js';
import ownerConfigSchema from '../schemas/config.schema.json' with { type: 'json' };
import manifest from '../agon.mod.json' with { type: 'json' };

export { runForgeCompetition };

// Resource identity is not part of the executable schema subset.
const { $id: _configSchemaId, ...configSchema } = ownerConfigSchema;

const inputSchema = Object.freeze({
  type: "object",
  additionalProperties: true,
  required: ["task"],
  properties: {
    task: { type: "string", minLength: 1 },
    test: { type: "string" },
    engines: { type: "string" },
    judge: { type: "string" },
    cwd: { type: "string", default: process.cwd() },
    starter: { type: "string" },
    timeout: { type: "string" },
    mode: {
      type: "string",
      enum: ["implement", "improve", "validate"],
      default: "implement",
    },
    requireDiff: { type: ["boolean", "string"] },
    baselineMayPass: { type: "boolean", default: false },
    dryRun: { type: "boolean", default: false },
    acceptReviewOutput: { type: "string" },
    earlyFinalizeCount: { type: "string" },
    finalizeOnScore: { type: "string" },
    noHealthCheck: { type: "boolean", default: false },
    healthCheckTimeoutSec: { type: "string" },
    label: { type: "string" },
    quiet: { type: "boolean" },
    provenance: { type: "boolean" },
    _: { type: "array", items: { type: "string" } },
  },
}) as Readonly<Record<string, Json>>;
const cesarSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["task"],
  properties: {
    task: { type: "string", minLength: 1 },
    scope: { type: "string", enum: ["slice", "full"] },
    fitnessCmd: { type: "string" },
    hardened: { type: "boolean" },
    team: { type: "boolean" },
  },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({
  positionals: ["task"],
  aliases: { test: "t", starter: "s", engines: "e", judge: "j" },
  descriptions: {
    task: "Task implemented independently by each selected engine",
  },
});
const resultIds = [
  "resultAndEnvelopeTypes:0016",
  "resultAndEnvelopeTypes:0022",
  "resultAndEnvelopeTypes:0037",
  "resultAndEnvelopeTypes:0038",
  "resultAndEnvelopeTypes:0039",
  "resultAndEnvelopeTypes:0043",
  "resultAndEnvelopeTypes:0055",
  "resultAndEnvelopeTypes:0056",
  "resultAndEnvelopeTypes:0058",
  "resultAndEnvelopeTypes:0060",
  "resultAndEnvelopeTypes:0063",
  "resultAndEnvelopeTypes:0064",
  "resultAndEnvelopeTypes:0083",
  "resultAndEnvelopeTypes:0085",
  "resultAndEnvelopeTypes:0086",
  "resultAndEnvelopeTypes:0095",
  "resultAndEnvelopeTypes:0098",
  "resultAndEnvelopeTypes:0106",
  "resultAndEnvelopeTypes:0114",
  "resultAndEnvelopeTypes:0120",
  "resultAndEnvelopeTypes:0124",
  "resultAndEnvelopeTypes:0126",
  "resultAndEnvelopeTypes:0127",
  "resultAndEnvelopeTypes:0128",
  "resultAndEnvelopeTypes:0133",
  "resultAndEnvelopeTypes:0144",
];
const tuiIds = [
  "builtinCommandMetadata:0002",
  "builtinCommandMetadata:0025",
  "tuiSlashCommands:0002",
  "tuiSlashCommands:0033",
];
const cesarRouteIds = [
  "cesarRoutes:0023",
  "cesarRoutes:0024",
  "cesarRoutes:0025",
  "cesarRoutes:0026",
  "cesarRoutes:0027",
  "cesarRoutes:0028",
];

export const createMod: AgonModFactory = (services) =>
  Object.freeze({
    apiVersion: "1" as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const disposers: Dispose[] = [];
      const command = {
        description:
          "Run competing implementations in isolated worktrees and select by measured fitness",
        inputSchema,
        cli,
        run: (input: Json, context: InvocationContext) =>
          runForgeCompetition(input, context, services),
      };
      disposers.push(
        registrar.command("cli", { id: "cliCommands:0022", ...command }),
      );
      for (const id of tuiIds)
        disposers.push(registrar.command("tui", id === 'builtinCommandMetadata:0002' || id === 'tuiSlashCommands:0002'
          ? { id, description: 'Preview and apply a patch with confirmation', inputSchema: applyInputSchema, parse: parseApply, run: (input, context) => runApply(input, context, services) }
          : { id, ...command }));
      disposers.push(registrar.intent({ id: 'intentVariants:0002', description: 'Apply a patch with confirmation',
        inputSchema: applyInputSchema, parse: parseApply, run: (input, context) => runApply(input, context, services) }));
      for (const [id, prefix] of [
        ["intentVariants:0032", "forge"],
        ["intentVariants:0056", "suggest forge"],
      ] as const)
        disposers.push(
          registrar.intent({
            id,
            description: `Parse ${prefix} intent`,
            inputSchema,
            parse: (value) => {
              const lower = value.toLowerCase();
              if (!(lower.startsWith(prefix) || lower.startsWith(`/${prefix}`)))
                return undefined;
              const rest = value.replace(/^\/?[^ ]+\s*/, "");
              if (prefix !== "forge") return undefined;
              const hardened =
                /^(--hardened)\s+/i.test(rest) ||
                /\s+--hardened\s*$/i.test(rest);
              const cleaned = rest
                .replace(/^--hardened\s+/i, "")
                .replace(/\s+--hardened\s*$/i, "")
                .trim();
              const match = cleaned.match(
                /\b(?:test with|test:|--test|fitness:)\s+(.+)/i,
              );
              const fitnessCmd = match ? match[1].trim() : null;
              return {
                task: match ? cleaned.replace(match[0], "").trim() : cleaned,
                fitnessCmd,
                hardened,
              };
            },
            run: (input, context) =>
              runForgeCompetition(input, context, services),
          }),
        );
      disposers.push(
        registrar.tool("mcp", {
          id: "mcpTools:0009",
          description: command.description,
          inputSchema,
          effect: "process",
          run: async (input, context) =>
            commandResultToToolResult(await runForgeCompetition(input, context, services)),
        }),
      );
      for (const id of cesarRouteIds)
        disposers.push(
          registrar.planStep({
            id,
            inputSchema,
            resultSchema: inputSchema,
            risk: "workspace-write",
            run: (input, context) => runForgeCompetition(input, context, services),
          }),
        );
      disposers.push(
        registrar.tool("cesar", {
          id: "cesarTools:0010",
          description: "Hand this task to the competitive Forge workflow",
          inputSchema: cesarSchema,
          effect: "read",
          run: async () =>
            "Delegation accepted — end your turn now so the run can start.",
        }),
      );
      for (const id of resultIds)
        disposers.push(
          registrar.resultType({
            id,
            schema: { type: "object", additionalProperties: true },
            readableVersions: ">=0.2.0",
            render: async (payload) => ({
              text: JSON.stringify(payload, null, 2),
            }),
          }),
        );
      for (const { id } of manifest.contributes.configKeys)
        disposers.push(
          registrar.config(id, configSchema),
        );
      return async () => {
        for (const dispose of [...disposers].reverse()) await dispose();
      };
    },
  });

export default createMod;
