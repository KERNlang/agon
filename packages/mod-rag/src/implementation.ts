import { createHash } from "node:crypto";
import { commandResultToToolResult } from '@kernlang/agon-mod-api';
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  AgonModFactory,
  CommandResult,
  Dispose,
  InvocationContext,
  Json,
  ModServices,
  Registrar,
} from "@kernlang/agon-mod-api";
import {
  resolveDedupSidecar,
  resolveSidecarPython,
} from "@kernlang/agon-support-dedup";
import { withFileLock } from "@kernlang/agon-support-persistence";
import { loadRagIndex, ragDir, saveRagIndex } from "./store.js";
import type {
  RagChunk,
  RagHit,
  RagIndexResult,
  RagManifest,
  RagQueryResult,
} from "./types.js";
import { formatCitedBlocks } from "./grounding.js";
const MAX = 512 * 1024,
  CHUNK = 2048,
  OVERLAP = 256;
export function collectCorpusFiles(root: string) {
  const out: string[] = [];
  const push = (rel: string) => {
    try {
      const s = statSync(join(root, rel));
      if (s.isFile() && s.size <= MAX && rel.toLowerCase().endsWith(".md"))
        out.push(rel);
    } catch {}
  };
  for (const e of readdirSync(root)) {
    if (e === "docs") continue;
    push(e);
  }
  const walk = (rel: string) => {
    if (!existsSync(join(root, rel))) return;
    for (const e of readdirSync(join(root, rel))) {
      const child = join(rel, e);
      try {
        statSync(join(root, child)).isDirectory() ? walk(child) : push(child);
      } catch {}
    }
  };
  walk("docs");
  return [...new Set(out)].sort();
}
export function chunkMarkdown(text: string, source: string): RagChunk[] {
  const lines = text.split(/\r?\n/),
    out: RagChunk[] = [];
  let start = 0,
    buffer: string[] = [];
  const flush = (end: number) => {
    const body = buffer.join("\n").trim();
    if (body)
      out.push({
        id: `${source}:L${start + 1}-${end + 1}`,
        source,
        startLine: start + 1,
        endLine: end + 1,
        text: body,
      });
  };
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,3}\s/.test(lines[i]) && buffer.length) {
      flush(i - 1);
      buffer = [];
      start = i;
    }
    buffer.push(lines[i]);
    if (buffer.join("\n").length >= CHUNK) {
      flush(i);
      let chars = 0,
        carry: string[] = [];
      for (let j = buffer.length - 1; j >= 0 && chars < OVERLAP; j--) {
        carry.unshift(buffer[j]);
        chars += buffer[j].length + 1;
      }
      buffer = carry;
      start = i - carry.length + 1;
    }
  }
  flush(lines.length - 1);
  return out;
}
function embed(texts: string[]) {
  const sidecar = resolveDedupSidecar("embedder.py");
  if (!sidecar) throw new Error("RAG embedder asset is unavailable");
  const result = spawnSync(resolveSidecarPython(), [sidecar], {
    input:
      texts
        .map((text, id) => JSON.stringify({ id: String(id), text }))
        .join("\n") + "\n",
    encoding: "utf8",
    timeout: Number(process.env.AGON_RAG_EMBED_TIMEOUT_MS) || 180000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout)
    throw new Error(
      `RAG embedder failed: ${String(result.stderr ?? "").trim() || "install fastembed and numpy"}`,
    );
  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed.vectors) || parsed.vectors.length !== texts.length)
    throw new Error("RAG embedder returned the wrong vector count");
  return {
    model: String(parsed.model),
    dims: Number(parsed.dims),
    vectors: parsed.vectors.map((x: any) => x.vector as number[]),
  };
}
function corpus(root: string) {
  const files = collectCorpusFiles(root);
  const entries = files.map((path) => ({
    path,
    sha: createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex"),
  }));
  const h = createHash("sha256");
  for (const e of entries) h.update(`${e.path}\n${e.sha}\n`);
  return { files, entries, hash: h.digest("hex").slice(0, 16) };
}
export function buildRagIndex(root: string, force = false): RagIndexResult {
  const started = Date.now(),
    c = corpus(root);
  if (!c.files.length) throw new Error("No Markdown corpus found");
  const prior = loadRagIndex(root, c.hash);
  if (prior && !force)
    return {
      corpusHash: c.hash,
      fileCount: c.files.length,
      chunkCount: prior.chunks.length,
      durationMs: Date.now() - started,
      reused: true,
    };
  const chunks = c.files.flatMap((file) =>
    chunkMarkdown(readFileSync(join(root, file), "utf8"), file),
  );
  if (!chunks.length) throw new Error("Corpus produced no chunks");
  const embedded = embed(chunks.map((x) => x.text));
  const matrix = Float32Array.from(embedded.vectors.flat());
  const manifest: RagManifest = {
    corpusHash: c.hash,
    model: embedded.model,
    dims: embedded.dims,
    chunkCount: chunks.length,
    files: c.entries,
    builtAt: Date.now(),
  };
  withFileLock(ragDir(root) + ".lock", () =>
    saveRagIndex(root, manifest, chunks, matrix),
  );
  return {
    corpusHash: c.hash,
    fileCount: c.files.length,
    chunkCount: chunks.length,
    durationMs: Date.now() - started,
    reused: false,
  };
}
function hits(
  vector: number[],
  chunks: RagChunk[],
  matrix: Float32Array,
  dims: number,
  k: number,
): RagHit[] {
  const scored = chunks
    .map((chunk, row) => {
      let score = 0;
      for (let d = 0; d < dims; d++)
        score += (matrix[row * dims + d] ?? 0) * (vector[d] ?? 0);
      return { ...chunk, score: Math.round(score * 10000) / 10000 };
    })
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored;
}
export function queryRag(
  root: string,
  query: string,
  topK = 4,
): RagQueryResult {
  const c = corpus(root);
  let index = loadRagIndex(root, c.hash);
  if (!index) {
    buildRagIndex(root);
    index = loadRagIndex(root, c.hash);
  }
  if (!index) throw new Error("RAG index could not be loaded");
  const q = embed([query]);
  if (q.dims !== index.manifest.dims || q.model !== index.manifest.model)
    throw new Error("Embedding model drift; rebuild the index");
  const found = hits(
    q.vectors[0],
    index.chunks,
    index.matrix,
    index.manifest.dims,
    Math.max(1, topK),
  );
  return {
    query,
    hits: found,
    grounded: found.length > 0 && found[0].score >= 0.35,
  };
}
const schema = Object.freeze({
  type: "object",
  additionalProperties: true,
  required: ["action"],
  properties: {
    action: { type: "string" },
    text: { type: "string" },
    force: { type: "boolean", default: false },
    topK: { type: "string" },
    json: { type: "boolean", default: false },
    _: { type: "array", items: { type: "string" } },
  },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({ positionals: ["action", "text"] });
export async function runRag(
  raw: Json,
  context: InvocationContext,
  services: ModServices,
): Promise<CommandResult> {
  const x = raw as Record<string, Json>;
  let action = String(x.action ?? "query").trim();
  let text = String(x.text ?? "").trim();
  const combined = action.match(/^(query)\s+(.+)$/);
  if (combined) { action = combined[1]; text = text ? `${combined[2]} ${text}` : combined[2]; }
  const machine = x.json === true;
  try {
    let result: Json;
    if (action === "index") {
      if (
        (await services.permissions.check("fs.write", ragDir(context.cwd))) !==
        "allow"
      )
        return {
          exitCode: 1,
          stderr: "RAG indexing requires fs.write permission.\n",
        };
      result = buildRagIndex(context.cwd, x.force === true) as unknown as Json;
    } else if (action === "stats") {
      const index = loadRagIndex(context.cwd);
      result = (index
        ? {
            ...index.manifest,
            fileCount: index.manifest.files.length,
            matrixBytes: index.matrix.byteLength,
          }
        : { indexed: false }) as unknown as Json;
    } else if (action === "query") {
      if (!text) return { exitCode: 1, stderr: "RAG query requires text.\n" };
      if (
        !loadRagIndex(context.cwd) &&
        (await services.permissions.check("fs.write", ragDir(context.cwd))) !==
          "allow"
      )
        return {
          exitCode: 1,
          stderr:
            "RAG index is missing and auto-indexing requires fs.write permission.\n",
        };
      result = queryRag(
        context.cwd,
        text,
        Math.max(1, Number(x.topK) || 4),
      ) as unknown as Json;
    } else {
      return { exitCode: 1, stderr: `Unknown action "${action}". Usage: agon rag index | query "<text>" | stats\n` };
    }
    const receiptId = await services.receipts.record(`rag-${action}`, result);
    let stdout: string;
    if (machine) stdout = `${JSON.stringify({ ...(result as any), receiptId })}\n`;
    else if (action === "query") stdout = `${formatCitedBlocks(result as unknown as RagQueryResult)}\n`;
    else if (action === "index") {
      const indexed = result as unknown as RagIndexResult;
      stdout = `${indexed.reused ? "Index up to date" : "Indexed"}: ${indexed.fileCount} files → ${indexed.chunkCount} chunks in ${indexed.durationMs}ms (corpus ${indexed.corpusHash})\n`;
    } else {
      const stats = result as Record<string, Json>;
      stdout = stats.indexed === false
        ? `No index yet (looked in ${ragDir(context.cwd)}). Run: agon rag index\n`
        : `corpus ${String(stats.corpusHash)} · ${String(stats.fileCount)} files · ${String(stats.chunkCount)} chunks · ${String(stats.dims)} dims (${String(stats.model)})\nembeddings ${(Number(stats.matrixBytes) / 1024).toFixed(1)} KB · built ${new Date(Number(stats.builtAt)).toISOString()}\n`;
    }
    return {
      exitCode: 0,
      stdout,
      result: { ...(result as any), receiptId },
    };
  } catch (error) {
    return {
      exitCode: 1,
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}
export const createMod: AgonModFactory = (services) =>
  Object.freeze({
    apiVersion: "1" as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const command = {
        description:
          "Index and retrieve cited project documentation with local MiniLM embeddings",
        inputSchema: schema,
        run: (input: Json, context: InvocationContext) =>
          runRag(input, context, services),
      };
      const d: Dispose[] = [
        registrar.command("cli", { id: "cliCommands:0059", ...command, cli }),
        registrar.tool("mcp", {
          id: "mcpTools:0017",
          description: "Retrieve cited project context",
          inputSchema: schema,
          effect: "read",
          run: async (input, context) => {
            const out = await runRag(
              { ...(input as any), action: "query" },
              context,
              services,
            );
            return commandResultToToolResult(out);
          },
        }),
      ];
      for (const id of [
        "resultAndEnvelopeTypes:0102",
        "resultAndEnvelopeTypes:0103",
        "resultAndEnvelopeTypes:0104",
      ])
        d.push(
          registrar.resultType({
            id,
            schema: { type: "object", additionalProperties: true },
            readableVersions: ">=1",
            render: async (payload) => ({
              text: JSON.stringify(payload, null, 2),
            }),
          }),
        );
      return async () => {
        for (const x of [...d].reverse()) await x();
      };
    },
  });
export default createMod;
