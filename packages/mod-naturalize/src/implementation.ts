import { readFileSync, writeFileSync } from "node:fs";
import type {
  AgonModFactory,
  CommandResult,
  Dispose,
  InvocationContext,
  Json,
  ModServices,
  Registrar,
} from "@kernlang/agon-mod-api";
import { cleanText, scanText } from "@kernlang/agon-mod-sanitize";
const schema = Object.freeze({
  type: "object",
  additionalProperties: true,
  properties: {
    text: { type: "string" },
    file: { type: "string" },
    out: { type: "string" },
    engine: { type: "string" },
    author: { type: "string" },
    timeout: { type: "string", default: "120" },
    minChange: { type: "string" },
    maxAttempts: { type: "string", default: "2" },
    jsonl: { type: "boolean", default: false },
    _: { type: "array", items: { type: "string" } },
  },
}) as Readonly<Record<string, Json>>;
const cliSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    file: { type: "string" },
    engine: { type: "string" },
    author: { type: "string" },
    out: { type: "string" },
    timeout: { type: "string", default: "120" },
    minChange: { type: "string" },
    maxAttempts: { type: "string", default: "2" },
    jsonl: { type: "boolean", default: false },
  },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({ positionals: ["file"], aliases: { out: "o" } });
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
const words = (v: string) => v.trim().split(/\s+/).filter(Boolean);
function change(a: string, b: string) {
  const x = words(a),
    y = words(b);
  let same = 0;
  const count = new Map<string, number>();
  for (const w of x) count.set(w, (count.get(w) ?? 0) + 1);
  for (const w of y) {
    const n = count.get(w) ?? 0;
    if (n) {
      same++;
      count.set(w, n - 1);
    }
  }
  return {
    wordsBefore: x.length,
    wordsAfter: y.length,
    changedWords: Math.max(x.length, y.length) - same,
    unchangedRatio: same / Math.max(1, Math.max(x.length, y.length)),
  };
}
export async function runNaturalize(
  raw: Json,
  context: InvocationContext,
  services: ModServices,
): Promise<CommandResult> {
  const x = raw as Record<string, Json>;
  const file = String(x.file ?? "").trim();
  const input =
    typeof x.text === "string"
      ? x.text
      : file
        ? readFileSync(file, "utf8")
        : await readStdin();
  if (!input.trim())
    return {
      exitCode: 1,
      stderr: "Naturalize requires non-empty text, a file, or stdin.\n",
    };
  const active = [...((await services.engines.listActive?.(context)) ?? [])];
  const author = String(x.author ?? "").trim();
  const candidates = active.filter((id) => id !== author);
  const engine = String(x.engine ?? "").trim() || candidates[0];
  if (!engine || engine === author)
    return {
      exitCode: 1,
      stderr:
        "Naturalize requires an active rewriter different from the author.\n",
    };
  if (active.length > 0 && !active.includes(engine))
    return { exitCode: 1, stderr: `Naturalize engine is not active: ${engine}.\n` };
  const minRaw = x.minChange ?? x["min-change"] ?? 0;
  const minNumber = Number(minRaw);
  if (!Number.isFinite(minNumber) || minNumber < 0 || minNumber > 100)
    return { exitCode: 1, stderr: `Invalid --min-change '${String(minRaw)}' — expected a number 0-100.\n` };
  const min = minNumber / 100;
  const attempts = Math.max(1, Math.min(10, Number(x.maxAttempts ?? x["max-attempts"] ?? 2)));
  const source = cleanText(input).output;
  const run = services.runs ? await services.runs.start("naturalize", undefined, context) : undefined;
  let output = "",
    stats = change(source, source),
    actualAttempts = 0,
    lastDispatchError = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    actualAttempts = attempt;
    const prompt = `Rewrite the text into natural human prose while preserving every fact and its meaning. Change wording and rhythm${attempt > 1 ? " substantially" : ""}. Output only the rewritten text.\n\nTEXT:\n${source}`;
    let response: Record<string, Json>;
    try {
      response = (await services.engines.dispatch(engine, prompt, context, {
        mode: "exec",
        timeoutSeconds: Number(x.timeout ?? 120),
        systemPrompt: "Rewrite only. No commentary, tools, commands, or file access.",
      })) as Record<string, Json>;
    } catch (error) {
      lastDispatchError = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (response.exitCode !== 0 || response.timedOut === true) continue;
    output = cleanText(String(response.stdout ?? "")).output.trim();
    stats = change(source, output);
    if (output && 1 - stats.unchangedRatio >= min) break;
  }
  if (!output || 1 - stats.unchangedRatio < min) {
    if (run) await services.runs!.finish(run, { mode: "naturalize", startedAt: run.startedAt, endedAt: new Date().toISOString(), engines: [{ id: engine, status: "error", detail: lastDispatchError || `lexical-change gate below ${Math.round(min * 100)}%` }], summary: `${engine}: naturalize failed`, ok: false, requested: [engine], timeoutSec: Number(x.timeout ?? 120) }, context);
    return {
      exitCode: 1,
      stderr: `Rewrite did not meet the ${Math.round(min * 100)}% lexical-change gate.\n`,
      failure: {
        code: "NATURALIZE_GATE_FAILED",
        message: "Lexical change threshold not met",
        retryable: true,
      },
    };
  }
  if (!scanText(output).clean) {
    if (run) await services.runs!.finish(run, { mode: "naturalize", startedAt: run.startedAt, endedAt: new Date().toISOString(), engines: [{ id: engine, status: "error", detail: "deterministic re-scan failed" }], summary: `${engine}: naturalize failed`, ok: false, requested: [engine], timeoutSec: Number(x.timeout ?? 120) }, context);
    return {
      exitCode: 1,
      stderr: "Naturalized output failed deterministic re-scan.\n",
    };
  }
  const out = String(x.out ?? "").trim();
  if (out) {
    if ((await services.permissions.check("fs.write", out)) !== "allow") {
      if (run) await services.runs!.finish(run, { mode: "naturalize", startedAt: run.startedAt, endedAt: new Date().toISOString(), engines: [{ id: engine, status: "error", detail: "output write denied" }], summary: `${engine}: naturalize output denied`, ok: false, requested: [engine], timeoutSec: Number(x.timeout ?? 120) }, context);
      return { exitCode: 1, stderr: "fs.write permission denied.\n" };
    }
    writeFileSync(out, output, "utf8");
  }
  const result = {
    engine,
    author: author || null,
    output,
    finalClean: true,
    ...stats,
    changeRatio: 1 - stats.unchangedRatio,
    attempts: actualAttempts,
    minChange: min || null,
    minChangeMet: min > 0 ? 1 - stats.unchangedRatio >= min : null,
    runDir: run?.path ?? null,
    notAssessable: [
      "keyed statistical watermarks cannot be proven absent without the key",
    ],
  };
  const receiptId = await services.receipts.record(
    "naturalize",
    result as unknown as Json,
  );
  if (run) await services.runs!.finish(run, { mode: "naturalize", startedAt: run.startedAt, endedAt: new Date().toISOString(), engines: [{ id: engine, status: "ok", detail: `${stats.changedWords} word(s) changed (${Math.round((1 - stats.unchangedRatio) * 100)}% lexical change)` }], summary: `${engine}: naturalized`, ok: true, requested: [engine], timeoutSec: Number(x.timeout ?? 120) }, context);
  return {
    exitCode: 0,
    stdout: x.jsonl === true
      ? `${JSON.stringify({ type: "naturalize.result", source: file || "stdin", ...result, receiptId })}\n`
      : out
        ? `Naturalized output written to ${out}.\n`
        : `${output}${output.endsWith("\n") ? "" : "\n"}`,
    result: { ...result, receiptId } as unknown as Json,
  };
}
export const createMod: AgonModFactory = (services) =>
  Object.freeze({
    apiVersion: "1" as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const command = {
        description:
          "Sanitize, rewrite with a non-author engine, enforce lexical change, and re-scan",
        inputSchema: schema,
        run: (input: Json, context: InvocationContext) =>
          runNaturalize(input, context, services),
      };
      const d = [
        registrar.command("cli", {
          id: "cliCommands:0055",
          description: command.description,
          inputSchema: cliSchema,
          cli,
          run: command.run,
        }),
        registrar.command("tui", {
          id: "tuiSlashCommands:0046",
          ...command,
          parse: (value: string) => ({
            text: value.replace(/^\/naturalize\s*/i, ""),
          }),
        }),
      ];
      return async () => {
        for (const x of [...d].reverse()) await x();
      };
    },
  });
export default createMod;
