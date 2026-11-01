import { formatResearchResult } from './format-policy.js';
import type { ResearchSessionContext } from './session-workflow.js';
export { formatResearchResult } from './format-policy.js';
import { parseAuthoritativeResults } from './response-policy.js';
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";
import { buildPrompt } from './prompt-policy.js';
import type { Source } from './prompt-policy.js';
export { buildPrompt } from './prompt-policy.js';
export type { Source } from './prompt-policy.js';
import type {
  AgonModFactory,
  CommandResult,
  Dispose,
  InvocationContext,
  Json,
  ModServices,
  Registrar,
} from "@kernlang/agon-mod-api";
import { buildAuthoritativeRequest } from "./discovery-policy.js";
import { classifyQuery } from "./query-policy.js";
export { classifyQuery } from "./query-policy.js";
export type { ResearchIntent as Intent } from "./query-policy.js";
export interface CitationVerdict {
  url: string;
  verdict: "verified" | "blocked" | "dead" | "redirected" | "unreachable";
  httpStatus: number;
  detail: string;
}
export const discoveryRequest = buildAuthoritativeRequest;
export function validateUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "metadata.google.internal"
  )
    return null;
  if (isIP(h)) {
    if (
      h === "::1" ||
      h === "::" ||
      /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    )
      return null;
  }
  return u;
}
const blockedAddresses = new BlockList();
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4");
blockedAddresses.addAddress("::", "ipv6");
blockedAddresses.addAddress("::1", "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");

export function isBlockedAddress(raw: string) {
  const value = raw.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(value);
  if (!family) return true;
  return blockedAddresses.check(value, family === 4 ? "ipv4" : "ipv6");
}
export async function resolvePublicHost(
  hostname: string,
  resolver: typeof lookup = lookup,
) {
  const records = await resolver(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error("hostname resolved to no addresses");
  for (const record of records)
    if (isBlockedAddress(record.address))
      throw new Error(
        `hostname resolved to blocked address: ${record.address}`,
      );
  return records[0]!;
}
async function fetchBounded(url: string, signal: AbortSignal, max = 3500) {
  let current = validateUrl(url);
  if (!current) throw new Error("unsafe URL");
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  for (let hop = 0; hop <= 5; hop++) {
    const pinned = await resolvePublicHost(current.hostname);
    const dispatcher = new Agent({
      connect: {
        lookup(_hostname, _options, callback) {
          callback(null, pinned.address, pinned.family);
        },
      },
    });
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: bounded,
        headers: {
          "user-agent": "agon-research/1.0",
          accept: "text/html,text/plain,application/json",
        },
        dispatcher,
      } as RequestInit);
    } catch (error) {
      await dispatcher.close();
      throw error;
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel();
      await dispatcher.close();
      const next = validateUrl(new URL(loc, current).toString());
      if (!next) throw new Error("unsafe redirect");
      current = next;
      continue;
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > 5 * 1024 * 1024) {
      await res.body?.cancel();
      await dispatcher.close();
      throw new Error("response too large");
    }
    const reader = res.body?.getReader(),
      decoder = new TextDecoder();
    let bytes = 0,
      raw = "";
    try {
      if (reader)
        while (true) {
          const x = await reader.read();
          if (x.done) break;
          bytes += x.value.byteLength;
          if (bytes > 5 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("response too large");
          }
          raw += decoder.decode(x.value, { stream: true });
        }
    } finally {
      await dispatcher.close();
    }
    if (!res.ok)
      throw Object.assign(new Error(`HTTP ${res.status}`), {
        status: res.status,
      });
    return {
      status: res.status,
      finalUrl: current.toString(),
      text: raw
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max),
    };
  }
  throw new Error("too many redirects");
}
const schema = Object.freeze({
  type: "object",
  additionalProperties: true,
  properties: {
    question: { type: "string" },
    engine: { type: "string" },
    engines: { type: "string" },
    count: { type: "string", default: "5" },
    timeout: { type: "string", default: "120" },
    json: { type: "boolean" },
    quiet: { type: "boolean" },
    label: { type: "string" },
    _: { type: "array", items: { type: "string" } },
  },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({
  positionals: ["question"],
  aliases: { engines: "e" },
});
export async function runResearch(
  raw: Json,
  context: InvocationContext & Pick<ResearchSessionContext, 'onStatus'>,
  services: ModServices,
): Promise<CommandResult> {
  const x = raw as Record<string, Json>,
    question = String(
      x.question ?? (Array.isArray(x._) ? x._.join(" ") : ""),
    ).trim();
  if (!question)
    return { exitCode: 1, stderr: "Research requires a question.\n" };
  const intent = classifyQuery(question),
    request = discoveryRequest(intent, question, Number(x.count ?? 5));
  if (!request)
    return {
      exitCode: 1,
      stderr: `No keyless authoritative lane for ${intent} research.\n`,
    };
  if (
    (await services.permissions.check("network.fetch", request.url)) !== "allow"
  )
    return { exitCode: 1, stderr: "Network permission denied.\n" };
  const timeoutSeconds = Math.max(1, Number(x.timeout ?? 120) || 120);
  const run = services.runs ? await services.runs.start("research", typeof x.label === "string" ? x.label : undefined, context) : undefined;
  const finish = async (ok: boolean, engineId: string, detail: string): Promise<void> => {
    if (!run) return;
    await services.runs!.finish(run, {
      mode: "research", label: typeof x.label === "string" ? x.label : null,
      startedAt: run.startedAt, endedAt: new Date().toISOString(),
      engines: [{ id: engineId || "(none)", status: ok ? "ok" : "error", detail }],
      summary: detail, ok, requested: engineId ? [engineId] : [], timeoutSec: timeoutSeconds,
    }, context);
  };
  try {
    context.onStatus?.(`discovering sources (${intent})…`);
    const discovered = await fetch(request.url, {
      headers: request.headers,
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(12000)]),
    });
    if (!discovered.ok) {
      await finish(false, "", `discovery failed: HTTP ${discovered.status}`);
      return {
        exitCode: 1,
        stderr: `Discovery failed: HTTP ${discovered.status}.\n`,
      };
    }
    const found = parseAuthoritativeResults(intent, await discovered.text())
      .filter((s) => validateUrl(s.url))
      .slice(0, Math.min(10, Math.max(1, Number(x.count ?? 5))));
    if (!found.length) {
      await finish(false, "", "no authoritative sources found");
      return { exitCode: 1, stderr: "No authoritative sources found.\n" };
    }
    context.onStatus?.(`reading ${found.length} sources…`);
    const sources: Source[] = await Promise.all(
      found.map(async (s) => {
        try {
          const f = await fetchBounded(s.url, context.signal);
          return { ...s, content: f.text, fetched: true };
        } catch {
          return { ...s, fetched: false };
        }
      }),
    );
    const active = [...((await services.engines.listActive?.(context)) ?? [])];
    const requested = String(x.engines ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const unknown = requested.filter((engineId) => active.length > 0 && !active.includes(engineId));
    if (unknown.length) { await finish(false, "", `unknown engines: ${unknown.join(", ")}`); return { exitCode: 1, stderr: `Unknown or inactive research engines: ${unknown.join(", ")}.\n` }; }
    const pool = requested.length ? requested : active;
    const forced = String(x.engine ?? "").trim();
    if (forced && active.length > 0 && !active.includes(forced)) { await finish(false, forced, "forced engine is inactive"); return { exitCode: 1, stderr: `Unknown or inactive research engine: ${forced}.\n` }; }
    const ranking = !forced && services.engines.rank ? await services.engines.rank(pool, [], context) : [];
    const engine = forced || ranking[0]?.engineId || pool[0];
    if (!engine) { await finish(false, "", "no active drafting engine"); return { exitCode: 1, stderr: "No active drafting engine.\n" }; }
    context.onStatus?.(`${engine} drafting a grounded answer…`);
    const draft = (await services.engines.dispatch(
      engine,
      buildPrompt(question, sources),
      context,
      {
        mode: "exec",
        timeoutSeconds,
        systemPrompt:
          "Use only supplied sources. Cite [n]. Do not use tools or prior knowledge.",
      },
    )) as Record<string, Json>;
    const answer = String(draft.stdout ?? "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();
    if (draft.exitCode !== 0 || !answer) {
      await finish(false, engine, "draft engine produced no answer");
      return { exitCode: 1, stderr: "Draft engine produced no answer.\n" };
    }
    context.onStatus?.('verifying citations…');
    const cited = [
      ...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))),
    ];
    const invalid = cited.filter((n) => n < 1 || n > sources.length);
    const used = cited.filter((n) => n >= 1 && n <= sources.length);
    const results: CitationVerdict[] = await Promise.all(
      used.map(async (n) => {
        const url = sources[n - 1].url;
        try {
          const r = await fetchBounded(url, context.signal, 16000);
          return {
            url,
            verdict:
              new URL(r.finalUrl).hostname === new URL(url).hostname
                ? "verified"
                : "redirected",
            httpStatus: r.status,
            detail: "independent re-fetch",
          } as CitationVerdict;
        } catch (error: any) {
          const status = Number(error?.status ?? 0);
          return {
            url,
            verdict: [401, 403, 429].includes(status)
              ? "blocked"
              : status >= 400
                ? "dead"
                : "unreachable",
            httpStatus: status,
            detail: String(error?.message ?? error),
          } as CitationVerdict;
        }
      }),
    );
    const verified = results.filter((r) => r.verdict === "verified").length,
      blocked = results.filter((r) => r.verdict === "blocked").length,
      rejected = results.length - verified - blocked + invalid.length;
    const grounded =
      used.length > 0 && verified > 0 && invalid.length === 0 && rejected === 0;
    const result = {
      ok: grounded,
      question,
      intent,
      engineId: engine,
      answer,
      sources: sources.map(({ content, ...s }) => s),
      citations: {
        total: results.length + invalid.length,
        verified,
        blocked,
        rejected,
        invalidNumbers: invalid,
        results,
      },
      note: grounded
        ? undefined
        : "Citation verification did not prove a grounded answer",
      outputDir: run?.path ?? null,
    };
    const receiptId = await services.receipts.record(
      "research",
      result as unknown as Json,
    );
    await finish(grounded, engine, grounded
      ? `${engine}: ${verified}/${results.length + invalid.length} citations verified (${intent})`
      : `${engine}: citation verification did not prove a grounded answer`);
    const withReceipt = { ...result, receiptId };
    const stdout = x.json === true
      ? `${JSON.stringify(withReceipt, null, 2)}\n`
      : x.quiet === true && grounded
        ? `${answer}\n`
        : grounded
          ? `${formatResearchResult(result)}\n`
          : undefined;
    return {
      exitCode: grounded ? 0 : 1,
      ...(stdout ? { stdout } : { stderr: `${result.note}\n` }),
      result: withReceipt as unknown as Json,
    };
  } catch (error) {
    await finish(false, "", `research failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      exitCode: 1,
      stderr: `Research failed: ${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}
function parseResearch(value: string) {
  let rest = value.replace(/^\/research\s*/i, ""),
    count: number | undefined,
    engineId: string | undefined;
  const countMatch = rest.match(/--count\s+(\d+)/);
  if (countMatch) {
    count = Number.parseInt(countMatch[1], 10);
    rest = rest.replace(countMatch[0], " ");
  }
  const engineMatch = rest.match(/--engine\s+(\S+)/);
  if (engineMatch) {
    engineId = engineMatch[1];
    rest = rest.replace(engineMatch[0], " ");
  }
  return { question: rest.replace(/\s+/g, " ").trim(), count, engine: engineId, engineId };
}
export const createMod: AgonModFactory = (services) =>
  Object.freeze({
    apiVersion: "1" as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const command = {
        description:
          "Keyless authoritative research with bounded fetching and independently verified citations",
        inputSchema: schema,
        run: (input: Json, context: InvocationContext) =>
          runResearch(input, context, services),
      };
      const d = [
        registrar.command("cli", { id: "cliCommands:0062", ...command, cli }),
        registrar.command("tui", {
          id: "tuiSlashCommands:0055",
          ...command,
          parse: parseResearch,
        }),
        registrar.resultType({
          id: "resultAndEnvelopeTypes:0034",
          schema: { type: "object", additionalProperties: true },
          readableVersions: ">=1",
          render: async (payload) => ({
            text: JSON.stringify(payload, null, 2),
          }),
        }),
      ];
      for (const id of ['resultAndEnvelopeTypes:0106']) d.push(registrar.resultType({ id, schema: { type: 'object', additionalProperties: true }, readableVersions: '>=0.2.0', render: async (payload) => ({ text: JSON.stringify(payload, null, 2) }) }));
      return async () => {
        for (const x of [...d].reverse()) await x();
      };
    },
  });
export default createMod;
