// @kern-source: persistent-session:1
import { spawn } from 'node:child_process';

// @kern-source: persistent-session:2
import type { ChildProcess } from 'node:child_process';

// @kern-source: persistent-session:3
import { createInterface } from 'node:readline';

// @kern-source: persistent-session:4
import type { EngineDefinition, CompanionConfig } from './types.js';

// @kern-source: persistent-session:5
import { apiStreamDispatch, apiStreamDispatchWithHistory } from './api-dispatch.js';

// @kern-source: persistent-session:7
export interface SessionChunk {
  type: 'text'|'status'|'tool_call'|'error'|'done';
  content: string;
  metadata?: Record<string,unknown>;
}

// @kern-source: persistent-session:12
export interface SessionSendOptions {
  message: string;
  images?: string[];
  signal?: AbortSignal;
  systemPrompt?: string;
}

// @kern-source: persistent-session:18
export interface PersistentSessionConfig {
  engine: EngineDefinition;
  binaryPath: string;
  cwd: string;
  systemPrompt?: string;
  onApproval?: (tool: string, command: string) => Promise<boolean>;
}

// @kern-source: persistent-session:25
export interface PersistentSession {
  alive: boolean;
  sessionId: string|null;
  engineId: string;
  start: () => Promise<void>;
  send: (opts: SessionSendOptions) => AsyncGenerator<SessionChunk, void, void>;
  close: () => void;
}

// @kern-source: persistent-session:33
export function createPersistentSession(config: PersistentSessionConfig): PersistentSession {
  const engine = config.engine;
  
  // API path: engine has API config and no binary path provided → use stateless resume session
  if (engine.api && !config.binaryPath) {
    return createResumeSession(config);
  }
  
  // Claude: bidirectional stream-json pipe
  if ((engine.id === 'claude' || engine.binary === 'claude') && config.binaryPath) {
    return createStreamJsonSession(config);
  }
  
  // Engines with ACP protocol (OpenCode, Gemini)
  if (engine.companion && engine.companion.protocol === 'acp') {
    return createAcpSession(config);
  }
  
  // Engines with JSONRPC companion (Codex)
  if (engine.companion && engine.companion.protocol === 'jsonrpc') {
    return createCompanionSession(config);
  }
  
  // Fallback: resume-based (spawn per turn with --resume/--continue)
  return createResumeSession(config);
}

// @kern-source: persistent-session:64
export function createCompanionSession(config: PersistentSessionConfig): PersistentSession {
  let proc: ChildProcess | null = null;
  let alive = false;
  let sessionId: string | null = null;
  let threadId: string | null = null;
  let nextRpcId = 1;
  let firstTurn = true;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  let notificationHandlers: Array<(method: string, params: any) => void> = [];
  
  function sendRpc(method: string, params: Record<string, unknown>): Promise<any> {
    const id = nextRpcId++;
    const timeoutMs = method === 'initialize' ? 8000 : 90000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      proc!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  
  function notifyRpc(method: string): void {
    proc!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  }
  
  function killProc(): void {
    if (!proc) return;
    try {
      if (proc.pid) process.kill(-proc.pid, 'SIGTERM');
    } catch (e) {
      console.warn(`[agon] persistent-session: group kill failed (pid=${proc.pid}): ${e instanceof Error ? e.message : String(e)}`);
      try { proc.kill('SIGTERM'); } catch (e2) { console.warn(`[agon] persistent-session: direct kill also failed: ${e2 instanceof Error ? e2.message : String(e2)}`); }
    }
    proc = null;
    alive = false;
  }
  
  const session: PersistentSession = {
    get alive() { return alive; },
    get sessionId() { return sessionId; },
    engineId: config.engine.id,
  
    async start() {
      if (alive) return;
  
      const companion = config.engine.companion!;
      proc = spawn(config.binaryPath, companion.serverCmd, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: config.cwd,
        detached: true,
      });
  
      // Wire up JSONRPC line parser
      const rl = createInterface({ input: proc.stdout! });
      rl.on('line', (line: string) => {
        if (!line.trim()) return;
        let msg: any;
        try { msg = JSON.parse(line); } catch { return; }
  
        if (msg.id !== undefined && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) {
            p.reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`));
          } else {
            p.resolve(msg.result ?? {});
          }
          return;
        }
  
        // Server REQUEST with method (has id + method) — engine asking for approval
        if (msg.id !== undefined && msg.method) {
          const m = msg.method;
          console.error(`[cesar:companion] server request: ${m} id=${msg.id}`);
  
          // Map Codex approval method names to tool categories
          const methodToolMap: Record<string, string> = {
            'item/commandExecution/requestApproval': 'Bash',
            'item/fileChange/requestApproval': 'Edit',
            'item/permissions/requestApproval': 'Permission',
          };
          const toolName = methodToolMap[m] ?? msg.params?.tool ?? msg.params?.command?.type ?? msg.params?.name ?? m;
          const toolCmd = msg.params?.command?.command ?? msg.params?.command ?? msg.params?.description ?? msg.params?.path ?? JSON.stringify(msg.params ?? {});
  
          // Emit as tool_call for UI visibility
          for (const handler of notificationHandlers) {
            handler('tool/approval', { tool: toolName, command: toolCmd, rpcId: msg.id });
          }
  
          // Route through Agon's permission callback for ALL server requests
          if (config.onApproval) {
            config.onApproval(String(toolName), String(toolCmd)).then((approved: boolean) => {
              if (proc) proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { approved } }) + '\n');
            }).catch(() => {
              if (proc) proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { approved: false } }) + '\n');
            });
          } else {
            // No approval callback — auto-approve to prevent deadlock
            proc!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { approved: true } }) + '\n');
          }
          return;
        }
  
        // Server notification — forward to active handlers
        if (msg.method) {
          for (const handler of notificationHandlers) {
            handler(msg.method, msg.params ?? {});
          }
        }
      });
  
      proc.on('close', () => { alive = false; proc = null; });
      proc.on('error', () => { alive = false; proc = null; });
  
      // Wait for process startup
      await new Promise((r) => setTimeout(r, 100));
  
      // Initialize handshake
      await sendRpc('initialize', {
        clientInfo: { name: 'agon-ai', title: 'Agon AI', version: '0.2.0' },
        capabilities: null,
      });
      notifyRpc('initialized');
  
      // Start persistent thread — read-only sandbox forces engine to use Agon's XML tools for writes/bash
      const threadParams: Record<string, unknown> = {
        cwd: config.cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: false,
      };
      if (config.systemPrompt) {
        threadParams.instructions = config.systemPrompt;
      }
      const threadResult = await sendRpc('thread/start', threadParams) as any;
      threadId = threadResult?.thread?.id ?? null;
      sessionId = threadId;
      alive = true;
    },
  
    async *send(opts: SessionSendOptions) {
      if (!alive || !proc) {
        yield { type: 'error' as const, content: 'Session not alive' };
        return;
      }
  
    const chunks: SessionChunk[] = [];
    let turnDone = false;
    let resolveWait: (() => void) | null = null;
    let emittedText = '';
  
    const pushDelta = (text: string) => {
      if (!text) return;
      chunks.push({ type: 'text', content: text });
      emittedText += text;
    };
  
    const pushSnapshot = (text: string) => {
      if (!text) return;
      let overlap = Math.min(emittedText.length, text.length);
      while (overlap > 0 && !emittedText.endsWith(text.slice(0, overlap))) {
        overlap -= 1;
      }
      const suffix = text.slice(overlap);
      if (!suffix) return;
      chunks.push({ type: 'text', content: suffix });
      emittedText += suffix;
    };
  
    // Abort signal — break out of wait loop on cancel
    const onAbort = () => {
      turnDone = true;
      chunks.push({ type: 'done', content: 'cancelled' });
        if (resolveWait) { resolveWait(); resolveWait = null; }
      };
      if (opts.signal?.aborted) { yield { type: 'done' as const, content: 'cancelled' }; return; }
      opts.signal?.addEventListener('abort', onAbort, { once: true });
  
      const handler = (method: string, params: any) => {
      if (method === 'turn/completed') {
        turnDone = true;
        chunks.push({ type: 'done', content: '' });
      } else if (method === 'tool/approval') {
        // Approval request routed from Agon — emit as tool_call chunk
        chunks.push({
          type: 'tool_call',
          content: params.tool ?? 'tool',
          metadata: { input: params.command, status: 'running', approval: true },
        });
      } else if (method === 'item/completed') {
        const item = params?.item;
        if (item?.type === 'agentMessage') {
          pushSnapshot(item.text ?? '');
        }
        if (item?.type === 'toolCall') {
          // Native tool execution completed — show in UI
          chunks.push({
            type: 'tool_call',
            content: item.name ?? item.type ?? 'tool',
            metadata: { input: item.input ?? '', output: item.output ?? '', status: 'done' },
          });
        }
        if (item?.type === 'enteredReviewMode') {
          pushSnapshot(item.review ?? '');
        }
      } else if (method === 'item/agentMessage/delta') {
        if (params?.delta) {
          pushDelta(params.delta);
        }
      } else if (method === 'error') {
        chunks.push({ type: 'error', content: JSON.stringify(params) });
        turnDone = true;
      }
        if (resolveWait) { resolveWait(); resolveWait = null; }
      };
  
      notificationHandlers.push(handler);
  
      try {
        // On first turn, prepend system prompt as context (fallback if thread/start instructions ignored)
        let message = opts.message;
        if (firstTurn && config.systemPrompt) {
          message = `[System Instructions]\n${config.systemPrompt}\n\n[User Message]\n${message}`;
          firstTurn = false;
        } else {
          firstTurn = false;
        }
  
        // Start turn on existing thread
        await sendRpc('turn/start', {
          threadId,
          input: [{ type: 'text', text: message, text_elements: [] }],
        });
  
        // Yield chunks as they arrive
        while (!turnDone) {
          if (chunks.length > 0) {
            yield chunks.shift()!;
          } else {
            await new Promise<void>((r) => { resolveWait = r; });
          }
        }
        // Drain remaining
        while (chunks.length > 0) {
          yield chunks.shift()!;
        }
      } finally {
        opts.signal?.removeEventListener('abort', onAbort);
        const idx = notificationHandlers.indexOf(handler);
        if (idx >= 0) notificationHandlers.splice(idx, 1);
      }
    },
  
    close() {
      for (const [, p] of pending) clearTimeout(p.timer);
      pending.clear();
      killProc();
    },
  };
  
  return session;
}

// @kern-source: persistent-session:334
export function createAcpSession(config: PersistentSessionConfig): PersistentSession {
  let proc: ChildProcess | null = null;
  let alive = false;
  let sessionId: string | null = null;
  let nextRpcId = 1;
  let firstTurn = true;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  let notificationHandlers: Array<(method: string, params: any) => void> = [];
  
  function sendRpc(method: string, params: Record<string, unknown>): Promise<any> {
    const id = nextRpcId++;
    const timeoutMs = method === 'initialize' ? 8000 : 90000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`ACP timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      proc!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  
  function killProc(): void {
    if (!proc) return;
    try {
      if (proc.pid) process.kill(-proc.pid, 'SIGTERM');
    } catch (e) {
      console.warn(`[agon] persistent-session: group kill failed (pid=${proc.pid}): ${e instanceof Error ? e.message : String(e)}`);
      try { proc.kill('SIGTERM'); } catch (e2) { console.warn(`[agon] persistent-session: direct kill also failed: ${e2 instanceof Error ? e2.message : String(e2)}`); }
    }
    proc = null;
    alive = false;
  }
  
  const session: PersistentSession = {
    get alive() { return alive; },
    get sessionId() { return sessionId; },
    engineId: config.engine.id,
  
    async start() {
      if (alive) return;
  
      // Use companion serverCmd if available, else fall back to binary-specific defaults
      const companion = config.engine.companion;
      const acpArgs = companion?.serverCmd
        ?? (config.engine.binary === 'gemini' || config.engine.id === 'gemini' ? ['--acp'] : ['acp']);
      proc = spawn(config.binaryPath, acpArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: config.cwd,
        detached: true,
      });
  
      const rl = createInterface({ input: proc.stdout! });
      rl.on('line', (line: string) => {
        if (!line.trim()) return;
        let msg: any;
        try { msg = JSON.parse(line); } catch { return; }
  
        // Response to our request
        if (msg.id !== undefined && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) {
            p.reject(new Error(`ACP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            p.resolve(msg.result ?? {});
          }
          return;
        }
  
        // Server REQUEST with method — engine asking us something (approval, etc.)
        if (msg.id !== undefined && msg.method) {
          const m = msg.method;
          console.error(`[cesar:acp] server request: ${m} id=${msg.id}`);
  
          const toolName = msg.params?.tool ?? msg.params?.name ?? msg.params?.type ?? m;
          const toolCmd = msg.params?.command ?? msg.params?.description ?? JSON.stringify(msg.params ?? {});
  
          for (const handler of notificationHandlers) {
            handler('tool/approval', { tool: toolName, command: toolCmd, rpcId: msg.id });
          }
  
          if (config.onApproval) {
            config.onApproval(String(toolName), String(toolCmd)).then((approved: boolean) => {
              if (proc) proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { approved } }) + '\n');
            }).catch(() => {
              if (proc) proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { approved: false } }) + '\n');
            });
          } else {
            proc!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { approved: true } }) + '\n');
          }
          return;
        }
  
        // Server notification
        if (msg.method) {
          for (const handler of notificationHandlers) {
            handler(msg.method, msg.params ?? {});
          }
        }
      });
  
      proc.on('close', () => { alive = false; proc = null; });
      proc.on('error', () => { alive = false; proc = null; });
  
      await new Promise((r) => setTimeout(r, 100));
  
      // ACP initialize handshake — read-only, writes go through Agon's XML tool system
      await sendRpc('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: 'agon-ai', title: 'Agon AI', version: '0.2.0' },
      });
  
      // Create session (pass system prompt if available)
      const sessParams: Record<string, unknown> = {
        cwd: config.cwd,
        mcpServers: [],
      };
      if (config.systemPrompt) {
        sessParams.systemPrompt = config.systemPrompt;
      }
      const sessResult = await sendRpc('session/new', sessParams) as any;
      sessionId = sessResult?.sessionId ?? null;
      alive = true;
    },
  
    async *send(opts: SessionSendOptions) {
      if (!alive || !proc || !sessionId) {
        yield { type: 'error' as const, content: 'ACP session not alive' };
        return;
      }
  
    const chunks: SessionChunk[] = [];
    let turnDone = false;
    let resolveWait: (() => void) | null = null;
    let emittedText = '';
  
    const pushDelta = (text: string) => {
      if (!text) return;
      chunks.push({ type: 'text', content: text });
      emittedText += text;
    };
  
    const pushSnapshot = (text: string) => {
      if (!text) return;
      let overlap = Math.min(emittedText.length, text.length);
      while (overlap > 0 && !emittedText.endsWith(text.slice(0, overlap))) {
        overlap -= 1;
      }
      const suffix = text.slice(overlap);
      if (!suffix) return;
      chunks.push({ type: 'text', content: suffix });
      emittedText += suffix;
    };
  
    const onAbort = () => {
      turnDone = true;
      chunks.push({ type: 'done', content: 'cancelled' });
      if (resolveWait) { resolveWait(); resolveWait = null; }
      };
      if (opts.signal?.aborted) { yield { type: 'done' as const, content: 'cancelled' }; return; }
      opts.signal?.addEventListener('abort', onAbort, { once: true });
  
      const handler = (method: string, params: any) => {
        if (method === 'tool/approval') {
          // Approval request routed from Agon — emit as tool_call chunk
          chunks.push({
            type: 'tool_call',
            content: params.tool ?? 'tool',
            metadata: { input: params.command, status: 'running', approval: true },
          });
        } else if (method === 'session/update') {
          const update = params?.update;
          if (!update) return;
          if (update.sessionUpdate === 'agent_message_chunk') {
            const text = update.content?.text ?? '';
            if (text) chunks.push({ type: 'text', content: text });
          } else if (update.sessionUpdate === 'tool_call') {
            chunks.push({ type: 'tool_call', content: update.title ?? '', metadata: { toolCallId: update.toolCallId, status: update.status, input: update.input, output: update.output } });
          } else if (update.sessionUpdate === 'plan') {
            chunks.push({ type: 'status', content: 'Planning...' });
          }
        }
        if (resolveWait) { resolveWait(); resolveWait = null; }
      };
  
      notificationHandlers.push(handler);
  
      try {
        // On first turn, prepend system prompt as context (fallback if session/new systemPrompt ignored)
        let message = opts.message;
        if (firstTurn && config.systemPrompt) {
          message = `[System Instructions]\n${config.systemPrompt}\n\n[User Message]\n${message}`;
          firstTurn = false;
        } else {
          firstTurn = false;
        }
  
        // session/prompt is a request — the response signals turn completion
        const promptPromise = sendRpc('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: message }],
        });
  
        // Yield streamed chunks while waiting for prompt response
        const donePromise = promptPromise.then((result: any) => {
          turnDone = true;
          chunks.push({ type: 'done', content: result?.stopReason ?? 'end_turn' });
          if (resolveWait) { resolveWait(); resolveWait = null; }
        }).catch((err: Error) => {
          turnDone = true;
          chunks.push({ type: 'error', content: err.message });
          if (resolveWait) { resolveWait(); resolveWait = null; }
        });
  
        while (!turnDone) {
          if (chunks.length > 0) {
            yield chunks.shift()!;
          } else {
            await new Promise<void>((r) => { resolveWait = r; });
          }
        }
        while (chunks.length > 0) {
          yield chunks.shift()!;
        }
      } finally {
        opts.signal?.removeEventListener('abort', onAbort);
        const idx = notificationHandlers.indexOf(handler);
        if (idx >= 0) notificationHandlers.splice(idx, 1);
      }
    },
  
    close() {
      for (const [, p] of pending) clearTimeout(p.timer);
      pending.clear();
      killProc();
    },
  };
  
  return session;
}

// @kern-source: persistent-session:585
export function createStreamJsonSession(config: PersistentSessionConfig): PersistentSession {
  let proc: ChildProcess | null = null;
  let alive = false;
  let sessionId: string | null = null;
  let lineHandlers: Array<(parsed: any) => void> = [];
  
  function killProc(): void {
    if (!proc) return;
    try {
      if (proc.pid) process.kill(-proc.pid, 'SIGTERM');
    } catch (e) {
      console.warn(`[agon] persistent-session: group kill failed (pid=${proc.pid}): ${e instanceof Error ? e.message : String(e)}`);
      try { proc.kill('SIGTERM'); } catch (e2) { console.warn(`[agon] persistent-session: direct kill also failed: ${e2 instanceof Error ? e2.message : String(e2)}`); }
    }
    proc = null;
    alive = false;
  }
  
  const session: PersistentSession = {
    get alive() { return alive; },
    get sessionId() { return sessionId; },
    engineId: config.engine.id,
  
    async start() {
      if (alive) return;
  
      const args = [
        '--print',
        '--verbose',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--replay-user-messages',
        '--max-turns', '0',
      ];
  
      if (config.systemPrompt) {
        args.push('--system-prompt', config.systemPrompt);
      }
  
      proc = spawn(config.binaryPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: config.cwd,
        detached: true,
      });
  
      // Parse NDJSON from stdout
      const rl = createInterface({ input: proc.stdout! });
      rl.on('line', (line: string) => {
        if (!line.trim()) return;
        let parsed: any;
        try { parsed = JSON.parse(line); } catch { return; }
  
        // Capture session ID from init event
        if (parsed.type === 'system' && parsed.session_id) {
          sessionId = parsed.session_id;
        }
  
        for (const handler of lineHandlers) {
          handler(parsed);
        }
      });
  
      // Log stderr for debugging startup issues
      proc.stderr?.on('data', (data: Buffer) => {
        const msg = String(data).trim();
        if (msg) console.error(`[cesar:claude:stderr] ${msg}`);
      });
  
      proc.on('close', (code: number | null) => {
        console.error(`[cesar:claude] process exited code=${code}`);
        alive = false;
        proc = null;
      });
      proc.on('error', (err: Error) => {
        console.error(`[cesar:claude] process error: ${err.message}`);
        alive = false;
        proc = null;
      });
  
      // Wait for first stdout line OR early process death
      const startOk = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(true), 5000);
        rl.once('line', () => { clearTimeout(timeout); resolve(true); });
        proc!.once('close', (code: number | null) => {
          clearTimeout(timeout);
          console.error(`[cesar:claude] process died during start, code=${code}`);
          resolve(false);
        });
      });
      if (!startOk || !proc) {
        alive = false;
        throw new Error('Claude stream-json process died during startup');
      }
      alive = true;
    },
  
    async *send(opts: SessionSendOptions) {
      if (!alive || !proc) {
        yield { type: 'error' as const, content: 'Claude stream session not alive' };
        return;
      }
  
      const chunks: SessionChunk[] = [];
      let turnDone = false;
      let resolveWait: (() => void) | null = null;
      let emittedText = '';
  
      const pushDelta = (text: string) => {
        if (!text) return;
        chunks.push({ type: 'text', content: text });
        emittedText += text;
      };
  
      const pushSnapshot = (text: string) => {
        if (!text) return;
        let overlap = Math.min(emittedText.length, text.length);
        while (overlap > 0 && !emittedText.endsWith(text.slice(0, overlap))) {
          overlap -= 1;
        }
        const suffix = text.slice(overlap);
        if (!suffix) return;
        chunks.push({ type: 'text', content: suffix });
        emittedText += suffix;
      };
  
      const onAbort = () => {
        turnDone = true;
        chunks.push({ type: 'done', content: 'cancelled' });
        if (resolveWait) { resolveWait(); resolveWait = null; }
      };
      if (opts.signal?.aborted) { yield { type: 'done' as const, content: 'cancelled' }; return; }
      opts.signal?.addEventListener('abort', onAbort, { once: true });
  
      const handler = (parsed: any) => {
        // Assistant text content
        if (parsed.type === 'assistant' && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === 'text' && block.text) {
              pushSnapshot(block.text);
            }
            // Tool use blocks inside assistant messages — mark native so Agon doesn't double-execute
            if (block.type === 'tool_use') {
              chunks.push({
                type: 'tool_call',
                content: block.name ?? 'tool',
                metadata: { input: block.input, status: 'native' },
              });
            }
          }
          // Check if this is the final message (stop_reason present)
          if (parsed.message?.stop_reason) {
            turnDone = true;
            chunks.push({ type: 'done', content: parsed.message.stop_reason });
          }
        }
  
        // Content block delta (streaming partial text)
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          pushDelta(parsed.delta.text);
        }
  
        // Result event — marks turn completion (text already emitted by assistant/delta events)
        if (parsed.type === 'result') {
          turnDone = true;
          // Only emit result text if nothing was streamed yet (fallback for non-streaming responses)
          if (!emittedText) {
            const text = parsed.result ?? '';
            if (text && typeof text === 'string') {
              pushSnapshot(text);
            }
          }
          chunks.push({ type: 'done', content: 'end_turn' });
        }
  
        // Message start with session info
        if (parsed.type === 'message_start' && parsed.session_id) {
          sessionId = parsed.session_id;
        }
  
        // Tool use events — Claude handles execution internally (--dangerously-skip-permissions)
        if (parsed.type === 'tool_use') {
          chunks.push({
            type: 'tool_call',
            content: parsed.name ?? 'tool',
            metadata: { input: parsed.input, status: 'native' },
          });
        }
  
        // Tool result events — Claude completed a tool, show output
        if (parsed.type === 'tool_result') {
          chunks.push({
            type: 'tool_call',
            content: parsed.name ?? 'tool',
            metadata: { output: parsed.content ?? parsed.output ?? '', status: 'done' },
          });
        }
  
        // Error
        if (parsed.type === 'error') {
          chunks.push({ type: 'error', content: parsed.error?.message ?? 'Unknown error' });
          turnDone = true;
        }
  
        if (resolveWait) { resolveWait(); resolveWait = null; }
      };
  
      lineHandlers.push(handler);
  
      try {
        // Send user message as NDJSON on stdin
        const envelope: Record<string, unknown> = {
          type: 'user',
          message: {
            role: 'user',
            content: opts.message,
          },
        };
        if (sessionId) envelope.session_id = sessionId;
  
        proc.stdin!.write(JSON.stringify(envelope) + '\n');
  
        // Yield chunks as they arrive
        while (!turnDone) {
          if (chunks.length > 0) {
            yield chunks.shift()!;
          } else {
            await new Promise<void>((r) => { resolveWait = r; });
          }
        }
        while (chunks.length > 0) {
          yield chunks.shift()!;
        }
      } finally {
        opts.signal?.removeEventListener('abort', onAbort);
        const idx = lineHandlers.indexOf(handler);
        if (idx >= 0) lineHandlers.splice(idx, 1);
      }
    },
  
    close() {
      // Close stdin to signal EOF, then kill
      if (proc?.stdin) {
        try { proc.stdin.end(); } catch (e) { console.warn(`[agon] persistent-session: stdin.end() failed: ${e instanceof Error ? e.message : String(e)}`); }
      }
      setTimeout(() => killProc(), 1000);
    },
  };
  
  return session;
}

// @kern-source: persistent-session:840
export function createResumeSession(config: PersistentSessionConfig): PersistentSession {
  let alive = false;
  let sessionId: string | null = null;
  let firstTurn = true;
  // Message history for API engines — enables multi-turn tool loops
  const messageHistory: Array<{role: string, content: string}> = [];
  
  const session: PersistentSession = {
    get alive() { return alive; },
    get sessionId() { return sessionId; },
    engineId: config.engine.id,
  
    async start() {
      alive = true;
      firstTurn = true;
      messageHistory.length = 0;
    },
  
    async *send(opts: SessionSendOptions) {
      if (!alive) {
        yield { type: 'error' as const, content: 'Session not started' };
        return;
      }
  
      // API-only engines: use HTTP dispatch with conversation history
      if (config.engine.api && !config.binaryPath) {
        // Inject system prompt on first turn
        if (firstTurn) {
          const sysPrompt = config.systemPrompt ?? opts.systemPrompt;
          if (sysPrompt) {
            messageHistory.push({ role: 'system', content: sysPrompt });
          }
          firstTurn = false;
        }
  
        // Append user message (or tool results on subsequent turns)
        messageHistory.push({ role: 'user', content: opts.message });
  
        // Smart context window: summarize old messages to control token growth.
        // Keep system prompt + last 10 messages verbatim. Summarize older ones.
        if (messageHistory.length > 14) {
          const hasSystem = messageHistory[0].role === 'system';
          const system = hasSystem ? [messageHistory[0]] : [];
          const cutoff = hasSystem ? 1 : 0;
          const old = messageHistory.slice(cutoff, -10);
          const recent = messageHistory.slice(-10);
  
          // Compress old messages into a single summary
          const summaryLines = old.map((m: {role:string, content:string}) => {
            const label = m.role === 'user' ? 'U' : 'A';
            const text = m.content.length > 150 ? m.content.slice(0, 150) + '…' : m.content;
            return `${label}: ${text}`;
          });
          const summary = { role: 'user', content: `[Earlier conversation summary — ${old.length} messages]\n${summaryLines.join('\n')}` };
  
          messageHistory.length = 0;
          messageHistory.push(...system, summary, ...recent);
        }
  
        let fullResponse = '';
        const gen = apiStreamDispatchWithHistory(config.engine.api, messageHistory, config.engine.timeout ?? 180, opts.signal);
        try {
          while (true) {
            const { value, done } = await gen.next();
            if (done) {
              const result = value as any;
              if (result?.stderr) {
                yield { type: 'error' as const, content: result.stderr };
              }
              break;
            }
            fullResponse += value as string;
            yield { type: 'text' as const, content: value as string };
          }
        } catch (err: any) {
          yield { type: 'error' as const, content: err.message ?? String(err) };
        }
  
        // Push assistant response to history for next turn
        if (fullResponse) {
          messageHistory.push({ role: 'assistant', content: fullResponse });
        }
  
        yield { type: 'done' as const, content: 'end_turn' };
        return;
      }
  
      const args: string[] = [];
      const engineExec = config.engine.exec;
      if (!engineExec) {
        yield { type: 'error' as const, content: `Engine ${config.engine.id} has no exec config` };
        return;
      }
  
      // Build args from engine config
      for (const arg of engineExec.args) {
        if (arg === '{prompt}') {
          args.push(opts.message);
        } else {
          args.push(arg);
        }
      }
  
      // Add resume flag on subsequent turns
      if (!firstTurn && sessionId) {
        // Try common resume flags
        if (config.engine.binary === 'claude') {
          args.unshift('--resume', sessionId);
        } else if (config.engine.binary === 'opencode') {
          args.unshift('--session', sessionId, '--continue');
        }
      }
  
      const child = spawn(config.binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: config.cwd,
        detached: true,
      });
  
      const chunks: SessionChunk[] = [];
      let done = false;
      let resolveWait: (() => void) | null = null;
  
      // Abort: kill spawned child process
      const onAbort = () => {
        done = true;
        chunks.push({ type: 'done', content: 'cancelled' });
        try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch (e) { console.warn(`[agon] session-stream: kill failed: ${e instanceof Error ? e.message : String(e)}`); try { child.kill('SIGTERM'); } catch {} }
        if (resolveWait) { resolveWait(); resolveWait = null; }
      };
      if (opts.signal?.aborted) { yield { type: 'done' as const, content: 'cancelled' }; return; }
      opts.signal?.addEventListener('abort', onAbort, { once: true });
  
      const rl = createInterface({ input: child.stdout! });
      rl.on('line', (line: string) => {
        // Try to parse as NDJSON
        try {
          const parsed = JSON.parse(line);
          if (parsed.session_id && !sessionId) {
            sessionId = parsed.session_id;
          }
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            chunks.push({ type: 'text', content: parsed.delta.text });
          } else if (parsed.type === 'assistant' && parsed.message?.content) {
            for (const block of parsed.message.content) {
              if (block.type === 'text' && block.text) chunks.push({ type: 'text', content: block.text });
            }
          } else if (parsed.type === 'result' && !chunks.some((c: any) => c.type === 'text')) {
            // Only use result text if no text was streamed yet
            const text = parsed.result ?? '';
            if (text && typeof text === 'string') chunks.push({ type: 'text', content: text });
          }
        } catch {
          // Raw text
          chunks.push({ type: 'text', content: line });
        }
        if (resolveWait) { resolveWait(); resolveWait = null; }
      });
  
      child.on('close', () => {
        done = true;
        chunks.push({ type: 'done', content: 'end_turn' });
        if (resolveWait) { resolveWait(); resolveWait = null; }
      });
  
      child.on('error', (err: Error) => {
        done = true;
        chunks.push({ type: 'error', content: err.message });
        if (resolveWait) { resolveWait(); resolveWait = null; }
      });
  
      try {
        while (!done) {
          if (chunks.length > 0) {
            yield chunks.shift()!;
          } else {
            await new Promise<void>((r) => { resolveWait = r; });
          }
        }
        while (chunks.length > 0) {
          yield chunks.shift()!;
        }
      } finally {
        opts.signal?.removeEventListener('abort', onAbort);
        firstTurn = false;
      }
    },
  
    close() {
      alive = false;
    },
  };
  
  return session;
}

