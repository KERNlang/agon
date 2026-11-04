export const WORKFLOW_GENERATION_ENV = 'AGON_JOB_GENERATION';
export const WORKFLOW_HANDSHAKE_TIMEOUT_MS = 5_000;

export interface WorkflowProcessAuthority {
  readonly generation: string;
  readonly assertCurrent: () => void;
  readonly timeoutMs?: number;
}

export class WorkflowHandshakeError extends Error {
  readonly code = 'MOD_GENERATION_MISMATCH';
  readonly restartRequired = true;
}

export function workflowHandshakeMessage(event: 'agon-job-ready' | 'agon-job-start', generation: string) {
  return { event, protocolVersion: 1, generation } as const;
}

export function matchesWorkflowHandshake(message: unknown, event: 'agon-job-ready' | 'agon-job-start', generation: string): boolean {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const value = message as Record<string, unknown>;
  return Object.keys(value).length === 3 && value.event === event
    && value.protocolVersion === 1 && value.generation === generation;
}

/** Wait for the parent before the child dispatches a command. */
export async function confirmWorkflowGeneration(generation: string, assertCurrent: () => void): Promise<void> {
  const expected = process.env[WORKFLOW_GENERATION_ENV];
  delete process.env[WORKFLOW_GENERATION_ENV];
  if (expected === undefined) return;
  try {
    if (!expected || expected !== generation || !process.send || !process.connected) {
      throw new WorkflowHandshakeError('job worker generation or IPC channel does not match its parent');
    }
    assertCurrent();
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        process.removeListener('message', onMessage);
        process.removeListener('disconnect', onDisconnect);
        if (error) reject(error); else resolve();
      };
      const onMessage = (message: unknown) => {
        if (!matchesWorkflowHandshake(message, 'agon-job-start', generation)) {
          finish(new WorkflowHandshakeError('job parent sent an invalid generation approval'));
          return;
        }
        try { assertCurrent(); }
        catch (error) { finish(error instanceof Error ? error : new Error(String(error))); return; }
        finish();
      };
      const onDisconnect = () => finish(new WorkflowHandshakeError('job parent disconnected before generation approval'));
      const timer = setTimeout(() => finish(new WorkflowHandshakeError('job parent generation approval timed out')), WORKFLOW_HANDSHAKE_TIMEOUT_MS);
      process.on('message', onMessage);
      process.once('disconnect', onDisconnect);
      process.send!(workflowHandshakeMessage('agon-job-ready', generation), error => {
        if (error) finish(error);
      });
    });
  } finally {
    if (process.connected) process.disconnect();
  }
}
