import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from "node:fs";

import { join, dirname } from "node:path";

import { createInterface } from "node:readline";

import { execSync } from "node:child_process";

import { FIRST_PARTY_SURFACE_CATALOG } from "@kernlang/agon-kernel";

import {
  appendMemoryLine,
  todayPrefix,
  canonicalMemorySection,
  MEMORY_SECTIONS,
} from "@kernlang/agon-core";

export const KERNEL_MCP_TOOLS: readonly DynamicMcpTool[] = Object.freeze([
  Object.freeze({
    name: 'ReportConfidence',
    description: 'Report confidence from 0 to 100 without ending the current turn.',
    inputSchema: { type: 'object', properties: { value: { type: 'number' }, reasoning: { type: 'string' } }, required: ['value'], additionalProperties: false },
    ownerId: 'agon.kernel',
  }),
  Object.freeze({
    name: 'AgonBash',
    description: 'Execute an approved shell command through the host permission boundary.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'], additionalProperties: false },
    ownerId: 'agon.kernel',
  }),
  Object.freeze({
    name: 'AgonEdit',
    description: 'Apply an approved exact text replacement through the host permission boundary.',
    inputSchema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'], additionalProperties: false },
    ownerId: 'agon.kernel',
  }),
  Object.freeze({
    name: 'AgonWrite',
    description: 'Write an approved file through the host permission boundary.',
    inputSchema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'], additionalProperties: false },
    ownerId: 'agon.kernel',
  }),
  Object.freeze({
    name: 'DeliverAnswer',
    description: 'Deliver the final answer over the host answer channel.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    ownerId: 'agon.kernel',
  }),
]);

const MCP_SURFACE_METADATA = new Map(
  FIRST_PARTY_SURFACE_CATALOG.filter(
    (entry) => entry.category === "mcpTools",
  ).map((entry) => [entry.publicId, entry]),
);

export interface DynamicMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly ownerId?: string;
}

export function dynamicMcpToolOwnsExecution(
  tool: DynamicMcpTool | undefined,
): boolean {
  return Boolean(tool?.ownerId && tool.ownerId !== "agon.kernel");
}

export function listMcpTools(
  available: ReadonlySet<string> = new Set(MCP_SURFACE_METADATA.keys()),
  dynamic: readonly DynamicMcpTool[] = [],
): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}> {
  const builtins = KERNEL_MCP_TOOLS
    .filter(
      (tool) =>
        MCP_SURFACE_METADATA.has(tool.name) &&
        available.has(tool.name) &&
        tool.ownerId === 'agon.kernel',
    )
    .map((t) => {
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      };
    });
  const builtinNames = new Set(builtins.map(({ name }) => name));
  return [
    ...builtins,
    ...dynamic
      .filter(({ name }) => available.has(name) && !builtinNames.has(name))
      .map(({ ownerId: _ownerId, ...tool }) => tool),
  ];
}

// ── Module: OrchestrationServer ──

/**
 * Append a signal to the signal file (array). Supports ReportConfidence + orchestration in same turn.
 */
export function writeSignal(tool: string, args: Record<string, unknown>) {
  const signalDir = process.env.AGON_SIGNAL_DIR;
  const sessionId = process.env.AGON_SESSION_ID;
  if (!signalDir || !sessionId) return;
  try {
    mkdirSync(signalDir, { recursive: true });
    const signalPath = join(signalDir, `${sessionId}.json`);
    let signals: Array<{
      tool: string;
      args: Record<string, unknown>;
      timestamp: number;
    }> = [];
    if (existsSync(signalPath)) {
      try {
        signals = JSON.parse(readFileSync(signalPath, "utf-8"));
      } catch {
        signals = [];
      }
    }
    signals.push({ tool, args, timestamp: Date.now() });
    writeFileSync(signalPath, JSON.stringify(signals));
  } catch {
    /* signal write failed — not critical */
  }
}

/**
 * Deliver the engine's final answer over the PTY answer-channel: write it to $AGON_SIGNAL_DIR/<session-id>-answer.json (overwritten per turn; turns are single-flight). The host's PTY session reads this as the authoritative response, bypassing flaky TUI scraping. Returns false if no signal transport is configured (so the caller can tell the engine to just print).
 */
function writeAnswer(text: string): boolean {
  // ONLY active when the host opted into the PTY answer-channel. The tool is
  // in every companion's registry, but codex/agy capture their reply natively
  // (no one reads this file for them) — so a stray DeliverAnswer from them
  // must return false → the caller tells them to just print their answer,
  // never silently swallowing it.
  if (process.env.AGON_ANSWER_CHANNEL !== "1") return false;
  const signalDir = process.env.AGON_SIGNAL_DIR;
  const sessionId = process.env.AGON_SESSION_ID;
  if (!signalDir || !sessionId) return false;
  try {
    mkdirSync(signalDir, { recursive: true });
    const answerPath = join(signalDir, `${sessionId}-answer.json`);
    writeFileSync(
      answerPath,
      JSON.stringify({
        type: "answer",
        text: String(text ?? ""),
        timestamp: Date.now(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function writePermissionRequest(
  id: string,
  tool: string,
  args: Record<string, unknown>,
): void {
  const signalDir = process.env.AGON_SIGNAL_DIR;
  const sessionId = process.env.AGON_SESSION_ID;
  if (!signalDir || !sessionId) return;
  mkdirSync(signalDir, { recursive: true });
  const requestPath = join(signalDir, `${sessionId}-perm-${id}.json`);
  writeFileSync(
    requestPath,
    JSON.stringify({
      type: "permission-request",
      id,
      tool,
      args,
      timestamp: Date.now(),
    }),
  );
}

function writeToolCompletion(
  id: string,
  tool: string,
  args: Record<string, unknown>,
  status: string,
  output: string,
): void {
  const signalDir = process.env.AGON_SIGNAL_DIR;
  const sessionId = process.env.AGON_SESSION_ID;
  if (!signalDir || !sessionId) return;
  try {
    mkdirSync(signalDir, { recursive: true });
    const completionPath = join(signalDir, `${sessionId}-tool-${id}.json`);
    const cappedOutput = String(output ?? "").slice(0, 12000);
    writeFileSync(
      completionPath,
      JSON.stringify({
        type: "tool-completion",
        id,
        tool,
        args,
        status: status === "error" ? "error" : "done",
        output: cappedOutput,
        timestamp: Date.now(),
      }),
    );
  } catch {
    /* completion signal is best-effort */
  }
}

async function pollPermissionResponse(
  id: string,
  timeoutMs: number,
): Promise<{ approved: boolean; reason?: string }> {
  const signalDir = process.env.AGON_SIGNAL_DIR;
  const sessionId = process.env.AGON_SESSION_ID;
  if (!signalDir || !sessionId)
    return { approved: false, reason: "No signal dir" };
  const requestPath = join(signalDir, `${sessionId}-perm-${id}.json`);
  const responsePath = join(signalDir, `${sessionId}-perm-${id}-response.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(responsePath)) {
      try {
        const data = JSON.parse(readFileSync(responsePath, "utf-8"));
        try {
          unlinkSync(responsePath);
        } catch {
          /* cleanup optional */
        }
        try {
          unlinkSync(requestPath);
        } catch {
          /* cleanup optional */
        }
        return { approved: !!data.approved, reason: data.reason };
      } catch {
        /* parse error — keep polling */
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    unlinkSync(requestPath);
  } catch {
    /* cleanup optional */
  }
  return { approved: false, reason: "Permission request timed out" };
}

/**
 * Handle write tool calls with permission — request approval, wait, execute.
 */
export async function executeApprovedKernelWrite(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const requestId = `pr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const toolMap: Record<string, string> = {
    AgonBash: "Bash",
    AgonEdit: "Edit",
    AgonWrite: "Write",
    SaveMemory: "SaveMemory",
  };
  const kernTool = toolMap[name] ?? name;

  // Write permission request signal
  writePermissionRequest(requestId, kernTool, args);

  // Poll for response (max 60 seconds)
  const response = await pollPermissionResponse(requestId, 60000);

  if (!response.approved) {
    const denied = `Permission denied: ${response.reason ?? "User declined"}. Do NOT retry this command — ask the user what they want instead.`;
    writeToolCompletion(requestId, name, args, "error", denied);
    return denied;
  }

  // Execute the approved tool
  try {
    if (name === "AgonBash") {
      const cmd = (args as any).command as string;
      const timeout = ((args as any).timeout ?? 30) * 1000;
      const cwd = process.env.AGON_CWD || process.cwd();
      const result = execSync(cmd, {
        cwd,
        timeout,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const output = result || "(command completed with no output)";
      writeToolCompletion(requestId, name, args, "done", output);
      return output;
    }
    if (name === "AgonEdit") {
      const filePath = (args as any).file_path as string;
      const oldStr = (args as any).old_string as string;
      const newStr = (args as any).new_string as string;
      const content = readFileSync(filePath, "utf-8");
      if (!content.includes(oldStr)) {
        const output = `Error: old_string not found in ${filePath}`;
        writeToolCompletion(requestId, name, args, "error", output);
        return output;
      }
      const updated = content.replace(oldStr, newStr);
      writeFileSync(filePath, updated);
      const output = `File edited: ${filePath}`;
      writeToolCompletion(requestId, name, args, "done", output);
      return output;
    }
    if (name === "AgonWrite") {
      const filePath = (args as any).file_path as string;
      const fileContent = (args as any).content as string;
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, fileContent);
      const output = `File written: ${filePath}`;
      writeToolCompletion(requestId, name, args, "done", output);
      return output;
    }
    if (name === "SaveMemory") {
      // Canonicalize + validate the section against the SAME MEMORY_SECTIONS list
      // the core tool uses, so this external-CLI path produces identical headers
      // and rejects non-canonical sections instead of writing a divergent header.
      const section = canonicalMemorySection((args as any).section);
      const memory = String((args as any).memory ?? "").trim();
      if (!section) {
        const output = `Invalid section "${String((args as any).section ?? "")}". Use one of: ${MEMORY_SECTIONS.join(", ")}`;
        writeToolCompletion(requestId, name, args, "error", output);
        return output;
      }
      const cwd = process.env.AGON_CWD || process.cwd();
      const memPath = join(cwd, ".agon", "project.md");
      const existing = existsSync(memPath)
        ? readFileSync(memPath, "utf-8")
        : "";
      const res = appendMemoryLine(existing, section, memory, todayPrefix());
      if (!res.changed) {
        const output = `Already in project memory [${section}] — skipped (near-duplicate).`;
        writeToolCompletion(requestId, name, args, "done", output);
        return output;
      }
      mkdirSync(dirname(memPath), { recursive: true });
      writeFileSync(
        memPath,
        res.content.endsWith("\n") ? res.content : res.content + "\n",
      );
      const note =
        res.status === "evicted"
          ? " (section was full — oldest entry dropped)"
          : "";
      const output = `Saved to project memory [${section}]: ${memory}${note}`;
      writeToolCompletion(requestId, name, args, "done", output);
      return output;
    }
    writeToolCompletion(requestId, name, args, "error", "Unknown write tool");
    return "Unknown write tool";
  } catch (err: any) {
    const output = `Error: ${err.message ?? String(err)}`;
    writeToolCompletion(requestId, name, args, "error", output);
    return output;
  }
}

/**
 * Start the Agon orchestration MCP server on stdio. Line-delimited JSONRPC 2.0.
 */
export function startMcpServer(
  available: ReadonlySet<string> = new Set(MCP_SURFACE_METADATA.keys()),
  assertCurrent: () => void = () => undefined,
  dynamicTools: () => readonly DynamicMcpTool[] = () => [],
  invokeDynamic: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<unknown> = async () => {
    throw new Error("dynamic MCP execution is unavailable");
  },
) {
  const rl = createInterface({ input: process.stdin, terminal: false });

  function respond(id: number | string | null, result: unknown): void {
    if (id === null) return; // notification — no response
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  function respondError(
    id: number | string | null,
    code: number,
    message: string,
  ): void {
    if (id === null) return;
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
    );
  }

  rl.on("line", (line: string) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    const { id, method, params } = msg;

    if (method === "initialize") {
      respond(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "agon-orchestration", version: "1.0.0" },
      });
      return;
    }

    if (method === "notifications/initialized" || method === "initialized") {
      // Client notification — no response needed
      return;
    }

    if (method === "tools/list" || method === "tools/call") {
      try {
        assertCurrent();
      } catch (error) {
        respondError(
          id,
          -32010,
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
    }

    if (method === "tools/list") {
      respond(id, {
        tools: listMcpTools(available, dynamicTools()),
      });
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name as string;
      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
      const dynamic = dynamicTools().find(({ name }) => name === toolName);
      if (
        (!MCP_SURFACE_METADATA.has(toolName) && !dynamic) ||
        !available.has(toolName)
      ) {
        respondError(id, -32602, "Unknown or disabled tool: " + toolName);
        return;
      }
      if (dynamicMcpToolOwnsExecution(dynamic)) {
        invokeDynamic(toolName, toolArgs)
          .then((result) => {
            const text =
              typeof result === "string" ? result : JSON.stringify(result);
            respond(id, { content: [{ type: "text", text }] });
          })
          .catch((error) => {
            respondError(
              id,
              -32603,
              `Dynamic MCP tool failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        return;
      }
      const tool = KERNEL_MCP_TOOLS.find((candidate) => candidate.name === toolName);
      if (!tool) {
        respondError(id, -32602, `Unknown tool: ${toolName}`);
        return;
      }
      // DeliverAnswer: write the final answer to the answer-channel file
      // (no permission, no dispatch). The host PTY session reads it as the
      // authoritative response. Tell the engine to stop after.
      if (toolName === "DeliverAnswer") {
        const ok = writeAnswer((toolArgs as any).text as string);
        respond(id, {
          content: [
            {
              type: "text",
              text: ok
                ? "Answer delivered. STOP responding now."
                : "No answer-channel configured — just print your answer as text.",
            },
          ],
        });
        return;
      }
      // Write tools need async permission flow
      const WRITE_TOOLS = new Set([
        "AgonBash",
        "AgonEdit",
        "AgonWrite",
      ]);
      if (WRITE_TOOLS.has(toolName)) {
        executeApprovedKernelWrite(toolName, toolArgs)
          .then((result: string) => {
            respond(id, { content: [{ type: "text", text: result }] });
          })
          .catch((err: any) => {
            respondError(
              id,
              -32603,
              `Tool execution failed: ${err.message ?? String(err)}`,
            );
          });
        return;
      }
      if (toolName === 'ReportConfidence') {
        writeSignal(toolName, toolArgs);
        respond(id, { content: [{ type: 'text', text: `Confidence ${String(toolArgs.value)}% recorded. Continue responding.` }] });
        return;
      }
      respondError(id, -32602, `Unknown kernel tool: ${toolName}`);
      return;
    }

    // Unknown method — ignore notifications, error on requests
    if (id !== undefined && id !== null) {
      respondError(id, -32601, `Method not found: ${method}`);
    }
  });

  rl.on("close", () => process.exit(0));
}
