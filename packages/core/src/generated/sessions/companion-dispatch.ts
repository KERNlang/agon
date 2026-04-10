// @kern-source: companion-dispatch:1
import { spawn } from 'node:child_process';

// @kern-source: companion-dispatch:2
import { createInterface } from 'node:readline';

// @kern-source: companion-dispatch:3
import type { DispatchResult, CompanionConfig } from '../models/types.js';

// @kern-source: companion-dispatch:5
export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: Record<string,unknown>;
  result?: Record<string,unknown>;
  error?: {code:number,message:string};
}

// @kern-source: companion-dispatch:13
export interface CompanionResult {
  text: string;
  threadId: string|null;
  fileChanges: Array<{changes:unknown,status:string}>;
  commands: Array<{command:string,exitCode:number,output:string}>;
}

// @kern-source: companion-dispatch:19
export async function companionDispatch(opts: {config:CompanionConfig, binaryPath:string, prompt:string, cwd:string, timeout:number, mode:'exec'|'review'|'agent', model?:string, signal?:AbortSignal, systemPrompt?:string}): Promise<DispatchResult> {
  if (opts.config.protocol !== 'jsonrpc' && opts.config.protocol !== 'acp' && opts.config.protocol !== 'stream-json') {
    return { exitCode: 2, stdout: '', stderr: `Protocol "${opts.config.protocol}" not supported for one-shot dispatch`, durationMs: 0, timedOut: false };
  }
  const isAcp = opts.config.protocol === 'acp';
  const isStreamJson = opts.config.protocol === 'stream-json';
  
  const startTime = Date.now();
  
  // Check if server mode is available (only needed for JSONRPC app-server)
  if (!isAcp && !isStreamJson) {
    const checkAvailable = (): Promise<boolean> => {
      return new Promise((resolve) => {
        const check = spawn(opts.binaryPath, ['app-server', '--help'], {
          stdio: 'pipe',
          timeout: 5000,
        });
        check.on('close', (code) => resolve(code === 0));
        check.on('error', () => resolve(false));
      });
    };
    const available = await checkAvailable();
    if (!available) {
      return { exitCode: 2, stdout: '', stderr: 'app-server not available', durationMs: Date.now() - startTime, timedOut: false };
    }
  }
  
  // Spawn the app-server process
  const proc = spawn(opts.binaryPath, opts.config.serverCmd, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: opts.cwd,
    detached: true,
  });
  
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  const agentMessages: string[] = [];
  let turnCompleted: Record<string, unknown> | null = null;
  let turnError: Record<string, unknown> | null = null;
  let threadId: string | null = null;
  
  // Parse line-delimited JSONRPC from stdout
  const rl = createInterface({ input: proc.stdout! });
  rl.on('line', (line: string) => {
    if (!line.trim()) return;
    let msg: JsonRpcMessage;
    try { msg = JSON.parse(line); } catch { return; }
  
    // Response to a request we sent
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
  
    // Stream-JSON events (Claude) — no method field, uses type field directly
    if (isStreamJson) {
      const raw = msg as any;
      if (raw.type === 'assistant' && raw.message?.content) {
        for (const block of raw.message.content) {
          if (block.type === 'text' && block.text) agentMessages.push(block.text);
        }
        if (raw.message.stop_reason) { turnCompleted = raw; }
      }
      if (raw.type === 'result') {
        if (!agentMessages.length && raw.result && typeof raw.result === 'string') {
          agentMessages.push(raw.result);
        }
        turnCompleted = raw;
      }
      if (raw.type === 'error') { turnError = raw; }
      return;
    }
  
    // Server notification — handle both JSONRPC and ACP protocols
    if (msg.method === 'turn/completed') {
      turnCompleted = (msg.params as Record<string, unknown>);
    } else if (msg.method === 'item/completed') {
      const item = (msg.params as any)?.item;
      if (item?.type === 'agentMessage') {
        agentMessages.push(item.text);
      }
      if (item?.type === 'enteredReviewMode') {
        agentMessages.push(item.review);
      }
    } else if (msg.method === 'session/update') {
      // ACP protocol notifications
      const update = (msg.params as any)?.update;
      if (update?.sessionUpdate === 'agent_message_chunk') {
        const text = update.content?.text ?? '';
        if (text) agentMessages.push(text);
      }
    } else if (msg.method === 'error') {
      turnError = (msg.params as Record<string, unknown>);
    }
  });
  
  function send(method: string, params: Record<string, unknown>): Promise<any> {
    const id = nextId++;
    const timeoutMs = method === 'initialize' ? 8000 : opts.timeout * 1000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  
  function notify(method: string): void {
    proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  }
  
  function killProc(): void {
    try {
      if (proc.pid) process.kill(-proc.pid, 'SIGTERM');
    } catch (e) {
      console.warn(`[agon] companion-dispatch: group kill failed (pid=${proc.pid}): ${e instanceof Error ? e.message : String(e)}`);
      try { proc.kill('SIGTERM'); } catch (e2) { console.warn(`[agon] companion-dispatch: direct kill also failed: ${e2 instanceof Error ? e2.message : String(e2)}`); }
    }
  }
  
  // Forward abort signal
  if (opts.signal) {
    if (opts.signal.aborted) { killProc(); return { exitCode: 130, stdout: '', stderr: 'Aborted', durationMs: 0, timedOut: false }; }
    opts.signal.addEventListener('abort', () => killProc(), { once: true });
  }
  
  function waitForTurnComplete(): Promise<void> {
    const deadline = Date.now() + opts.timeout * 1000;
    return new Promise((resolve, reject) => {
      const check = () => {
        if (turnCompleted) { resolve(); return; }
        if (turnError) { reject(new Error(`Turn error: ${JSON.stringify(turnError)}`)); return; }
        if (Date.now() > deadline) { reject(new Error('Turn timed out')); return; }
        if (opts.signal?.aborted) { reject(new Error('Aborted')); return; }
        setTimeout(check, 100);
      };
      check();
    });
  }
  
  try {
    // Wait a tick for process startup
    await new Promise((r) => setTimeout(r, 100));
  
    if (isStreamJson) {
      // Stream-JSON protocol (Claude Code) — NDJSON over stdio, no RPC handshake
      // Send user message as NDJSON on stdin, read events from stdout
      const envelope = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: opts.prompt },
      });
      proc.stdin!.write(envelope + '\n');
      proc.stdin!.end(); // Signal EOF — --max-turns 1 will complete after first response
  
      // Wait for result event or process exit
      await waitForTurnComplete();
    } else if (isAcp) {
      // ACP protocol (OpenCode/Gemini)
      await send('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'agon-ai', title: 'Agon AI', version: '0.2.0' },
      });
  
      const sessParams: Record<string, unknown> = { cwd: opts.cwd, mcpServers: [] };
      if (opts.systemPrompt) sessParams.systemPrompt = opts.systemPrompt;
      const sessResult = await send('session/new', sessParams) as any;
      const sessionId = sessResult?.sessionId ?? null;
  
      // session/prompt is a request — response signals turn completion
      const promptResult = await send('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: opts.prompt }],
      }) as any;
  
      // ACP returns text directly in the prompt response
      if (promptResult?.text) agentMessages.push(promptResult.text);
      turnCompleted = promptResult ?? {};
    } else {
      // JSONRPC protocol (Codex)
      await send('initialize', {
        clientInfo: { name: 'agon-ai', title: 'Agon AI', version: '0.1.0' },
        capabilities: null,
      });
      notify('initialized');
  
      const threadParams: Record<string, unknown> = {
        cwd: opts.cwd,
        approvalPolicy: 'never',
        // Only use engine-declared sandbox for agent mode. Exec/review stay read-only for safety.
        sandbox: opts.mode === 'agent' ? (opts.config.sandbox ?? 'workspace-write') : 'read-only',
        ephemeral: true,
      };
      if (opts.model) threadParams.model = opts.model;
      if (opts.systemPrompt) threadParams.instructions = opts.systemPrompt;
      const threadResult = await send('thread/start', threadParams) as any;
      threadId = threadResult?.thread?.id ?? null;
  
      if (opts.mode === 'review') {
        await send('review/start', { threadId, target: { type: 'uncommittedChanges' } });
      } else {
        await send('turn/start', { threadId, input: [{ type: 'text', text: opts.prompt, text_elements: [] }] });
      }
  
      await waitForTurnComplete();
    }
  
    const text = agentMessages.join('\n\n');
    return {
      exitCode: 0,
      stdout: text,
      stderr: '',
      durationMs: Date.now() - startTime,
      timedOut: false,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err instanceof Error && err.message.includes('timed out');
    const isAborted = err instanceof Error && err.message === 'Aborted';
    return {
      exitCode: isAborted ? 130 : isTimeout ? 124 : 2,
      stdout: agentMessages.join('\n\n'),
      stderr: err instanceof Error ? err.message : String(err),
      durationMs,
      timedOut: isTimeout,
    };
  } finally {
    // Clean up pending timers
    for (const [, p] of pending) clearTimeout(p.timer);
    pending.clear();
    killProc();
  }
}

