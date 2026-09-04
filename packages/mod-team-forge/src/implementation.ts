import type {
  AgonModFactory,
  CommandResult,
  Dispose,
  InvocationContext,
  Json,
  ModServices,
  Registrar,
} from "@kernlang/agon-mod-api";
import { runForgeCompetition } from "@kernlang/agon-mod-forge";
import { composePanelTeams } from "@kernlang/agon-support-panel";

const inputSchema = Object.freeze({
  type: "object",
  additionalProperties: true,
  required: ["task", "test"],
  properties: {
    task: { type: "string" },
    test: { type: "string" },
    engines: { type: "string" },
    members: { type: "string", default: "2" },
    cwd: { type: "string", default: process.cwd() },
    timeout: { type: "string", default: "300" },
    _: { type: "array", items: { type: "string" } },
  },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({
  positionals: ["task"],
  aliases: { test: "t", engines: "e", members: "m" },
  descriptions: { task: "Task for two collaborating implementation teams" },
});
const text = (value: Json | undefined): string =>
  typeof value === "string" ? value.trim() : "";
const list = (value: Json | undefined): string[] =>
  typeof value === "string"
    ? [
        ...new Set(
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];

async function run(
  raw: Json,
  context: InvocationContext,
  services: ModServices,
): Promise<CommandResult> {
  const input = raw as Record<string, Json>;
  const runContext = {
    ...context,
    cwd: text(input.cwd) || context.cwd,
  } satisfies InvocationContext;
  const task =
    text(input.task) ||
    (Array.isArray(input._) ? input._.map(String).join(" ").trim() : "");
  if (!task) return { exitCode: 1, stderr: "Team Forge requires a task.\n" };
  let engines = list(input.engines);
  if (!engines.length && services.engines.listActive)
    engines = [...(await services.engines.listActive(context))];
  if (engines.length < 2)
    return {
      exitCode: 1,
      stderr: "Team Forge requires at least two active engines.\n",
    };
  const membersPerTeam = Math.max(
    2,
    Math.min(8, Number.parseInt(text(input.members) || "2", 10) || 2),
  );
  const teams = composePanelTeams(engines, membersPerTeam);
  const failures: Array<{
    teamId: string;
    phase: string;
    engineId: string;
    error: string;
  }> = [];
  const dispatchText = async (
    teamId: string,
    engineId: string,
    prompt: string,
    phase: string,
  ): Promise<string> => {
    try {
      const output = (await services.engines.dispatch(
        engineId,
        prompt,
        runContext,
        {
          timeoutSeconds: Math.max(
            1,
            Number.parseInt(text(input.timeout) || "600", 10) || 600,
          ),
          mode: phase === "review" ? "review" : "exec",
          systemPrompt:
            "Collaborate as the assigned Team Forge role. Planning and review phases must not modify files.",
        },
      )) as Record<string, Json>;
      const value =
        output.exitCode === 0 && output.timedOut !== true
          ? text(output.stdout)
          : "";
      if (!value) throw new Error(text(output.stderr) || "empty response");
      return value;
    } catch (error) {
      failures.push({
        teamId,
        phase,
        engineId,
        error: error instanceof Error ? error.message : String(error),
      });
      return "";
    }
  };
  const submissions = await Promise.all(
    teams.map(async (team) => {
      const architect =
        team.members.find((member) => member.role === "architect") ??
        team.members[0];
      const reviewer =
        team.members.find((member) => member.role === "reviewer") ?? architect;
      const implementers = [
        ...new Set(
          team.members
            .filter((member) => member.role === "implementer")
            .map((member) => member.engineId),
        ),
      ];
      if (!implementers.length)
        implementers.push(team.members[team.members.length - 1].engineId);
      const plan = await dispatchText(
        team.teamId,
        architect.engineId,
        `TEAM FORGE TASK:\n${task}\n\nAs architect, inspect the task conceptually and produce a concrete implementation and verification plan for your implementer. Do not edit files.`,
        "plan",
      );
      if (!plan)
        return {
          teamId: team.teamId,
          members: team.members,
          plan: "",
          forge: null,
          pass: false,
          score: 0,
          winner: null,
          patch: null,
        };
      const forgeTask = `${task}\n\nTEAM ${team.teamId} ARCHITECT PLAN:\n${plan}`;
      const independentReviewer = implementers.includes(reviewer.engineId)
        ? ""
        : reviewer.engineId;
      const forge = await runForgeCompetition(
        {
          task: forgeTask,
          test: text(input.test),
          engines: implementers.join(","),
          judge: independentReviewer,
          timeout: text(input.timeout),
          baselineMayPass: true,
          requireDiff: true,
        },
        runContext,
        services,
      );
      const result =
        forge.result &&
        typeof forge.result === "object" &&
        !Array.isArray(forge.result)
          ? (forge.result as Record<string, Json>)
          : {};
      const candidates = Array.isArray(result.candidates)
        ? (result.candidates as Array<Record<string, Json>>)
        : [];
      const winning = candidates.find(
        (candidate) => candidate.engineId === result.winner,
      );
      return {
        teamId: team.teamId,
        members: team.members,
        plan,
        forge: result,
        pass: forge.exitCode === 0 && typeof result.winner === "string",
        score: Number(winning?.score ?? 0),
        winner: result.winner ?? null,
        patch: result.winningPatch ?? null,
      };
    }),
  );
  const eligible = submissions
    .filter((submission) => submission.pass)
    .sort(
      (left, right) =>
        right.score - left.score || left.teamId.localeCompare(right.teamId),
    );
  const winner = eligible[0] ?? null;
  const result = {
    task,
    fitness: text(input.test) || "true",
    membersPerTeam,
    teams,
    submissions,
    winnerTeamId: winner?.teamId ?? null,
    winningEngineId: winner?.winner ?? null,
    winningPatch: winner?.patch ?? null,
    panelHealth: { degraded: failures.length > 0, failures },
  };
  const receiptId = await services.receipts.record(
    "team-forge",
    result as unknown as Json,
  );
  return {
    exitCode: winner ? 0 : 1,
    stdout: `${JSON.stringify({ ...result, receiptId }, null, 2)}\n`,
    result: { ...result, receiptId } as unknown as Json,
    ...(winner
      ? {}
      : {
          failure: {
            code: "NO_PASSING_TEAM",
            message: "Neither Team Forge team produced a passing candidate",
            retryable: true,
          },
        }),
  };
}

export const createMod: AgonModFactory = (services) =>
  Object.freeze({
    apiVersion: "1" as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const disposers: Dispose[] = [];
      const command = {
        description:
          "Two collaborating teams compete using isolated implementation worktrees and measured fitness",
        inputSchema,
        cli,
        run: (input: Json, context: InvocationContext) =>
          run(input, context, services),
      };
      disposers.push(
        registrar.command("cli", { id: "cliCommands:0069", ...command }),
      );
      disposers.push(
        registrar.intent({
          id: "intentVariants:0060",
          description: "Parse team-forge intent",
          inputSchema,
          parse: (value) => {
            if (!/^\/team-forge(?:\s|$)/i.test(value)) return undefined;
            const parts = value.replace(/^\/team-forge\s*/i, "").split(/\s+/);
            const size = parts[0]?.match(/^(\d+)v\d+$/i);
            const rest = parts.slice(size ? 1 : 0).join(" ");
            const fitness = rest.match(
              /\b(?:test with|test:|--test|fitness:)\s+(.+)/i,
            );
            return {
              task: fitness ? rest.replace(fitness[0], "").trim() : rest,
              fitnessCmd: fitness ? fitness[1].trim() : null,
              ...(size ? { membersPerSide: Number(size[1]) } : {}),
            };
          },
          run: (input, context) => run(input, context, services),
        }),
      );
      for (const id of ["builtinCommandMetadata:0045", "tuiSlashCommands:0065"])
        disposers.push(registrar.command("tui", { id, ...command }));
      for (const id of ["cesarRoutes:0062", "cesarRoutes:0064"])
        disposers.push(
          registrar.planStep({
            id,
            inputSchema,
            resultSchema: inputSchema,
            risk: "workspace-write",
            run: (input, context) => run(input, context, services),
          }),
        );
      return async () => {
        for (const dispose of [...disposers].reverse()) await dispose();
      };
    },
  });

export default createMod;
