import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { JobTaskContext } from './job-service.js';

function validateChunkLimit(maxChars: number): void {
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) {
    throw new RangeError('Output chunk limit must be a positive safe integer');
  }
}

export function emitChunks(ctx: JobTaskContext, type: string, text: string, maxChars: number): void {
  validateChunkLimit(maxChars);
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + maxChars, text.length);
    const last = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      // Keep a surrogate pair intact. A one-unit limit needs two units for it.
      end += end - offset === 1 ? 1 : -1;
    }
    ctx.emit(type, { text: text.slice(offset, end) });
    offset = end;
  }
}

export async function runWorkflowCommand(ctx: JobTaskContext, script: string, args: string[], cwd: string, outputChunkChars: number, cancelGraceMs: number): Promise<number> {
  if (ctx.signal.aborted) throw new Error('Cancelled before workflow command started');
  validateChunkLimit(outputChunkChars);
  return await new Promise<number>((resolvePromise, rejectPromise) => {
    let settled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        AGON_CALL_DEPTH: String(Number(process.env.AGON_CALL_DEPTH ?? '0') + 1),
        AGON_CWD: cwd,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const signalTree = (signal: NodeJS.Signals): void => {
      if (!child.pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try { child.kill(signal); } catch { /* already gone */ }
      }
    };
    const cleanup = (): void => {
      ctx.signal.removeEventListener('abort', onAbort);
      if (forceTimer) clearTimeout(forceTimer);
    };
    const finish = (error: Error | null, code = 1): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectPromise(error); else resolvePromise(code);
    };
    const onAbort = (): void => {
      signalTree('SIGTERM');
      forceTimer = setTimeout(() => signalTree('SIGKILL'), cancelGraceMs);
      forceTimer.unref?.();
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => emitChunks(ctx, 'stdout', stdoutDecoder.write(chunk), outputChunkChars));
    child.stderr?.on('data', (chunk: Buffer) => emitChunks(ctx, 'stderr', stderrDecoder.write(chunk), outputChunkChars));
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => {
      emitChunks(ctx, 'stdout', stdoutDecoder.end(), outputChunkChars);
      emitChunks(ctx, 'stderr', stderrDecoder.end(), outputChunkChars);
      ctx.emit('command-finished', { command: args[0], exitCode: typeof code === 'number' ? code : 1, signal });
      finish(null, typeof code === 'number' ? code : 1);
    });
    if (ctx.signal.aborted) onAbort();
  });
}
