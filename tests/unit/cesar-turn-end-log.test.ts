import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyCesarTurnEnd, createCesarTurnEndTracker } from '../../packages/cli/src/cesar/turn-end-log.js';
import { replayCesarHarnessLogs, summarizeErrorForLog } from '../../packages/cli/src/cesar/tool-observability.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const apiStreamDispatchWithHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('../../packages/core/src/api/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/core/src/api/dispatch.js')>();
  return { ...actual, apiStreamDispatchWithHistory: apiStreamDispatchWithHistoryMock };
});

async function* streamBash(seq: number) {
  const args = { command: `echo ${seq}` };
  yield `\n<tool name="Bash">${JSON.stringify(args)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName: 'Bash', toolCallId: `call_${seq}`, args }] };
}

const TOOLS = [
  { type: 'function', function: { name: 'Bash', description: 'b', parameters: { type: 'object', properties: {} } } },
] as any;

let home: string;
let runsDir: string;

beforeEach(() => {
  home = setupTestAgonHome('turn-end-log');
  runsDir = mkdtempSync(join(tmpdir(), 'agon-turn-end-'));
});

afterEach(() => {
  apiStreamDispatchWithHistoryMock.mockReset();
  rmSync(runsDir, { recursive: true, force: true });
  cleanupTestAgonHome(home);
});

describe('Cesar turn-end log', () => {
  it('records a tool loop that ran out of steps as step_budget, not as a completed turn', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let seq = 0;
    apiStreamDispatchWithHistoryMock.mockImplementation(() => streamBash(++seq));
    const session = createResumeSession({
      engine: { id: 'turn-end-budget', api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'm' } } as any,
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: TOOLS,
      onToolCall: async () => 'ok',
    });
    await session.start();

    const tracker = createCesarTurnEndTracker(runsDir);
    tracker.bindTelemetry(() => ({ cesarEngineId: 'turn-end-budget', toolCount: 3 }));
    tracker.beginSend();
    for await (const chunk of session.send({ message: 'go', toolLoopBaseBudget: 3, toolLoopMaxBudget: 3 })) tracker.observe(chunk);
    tracker.settle({ delegated: false, responded: true, decisionReason: 'self-executed', terminalState: 'completed' } as any, false);

    const line = JSON.parse(readFileSync(join(runsDir, 'cesar-tool-timeline.jsonl'), 'utf-8').trim());
    expect(line).toMatchObject({ event: 'turn_end', turnId: tracker.turnId, status: 'step_budget' });
    expect(line.summary).toMatchObject({ endReason: 'step_budget', steps: 3, budget: 3, toolCount: 3, stepBudgetHits: 1 });
    expect(typeof line.summary.durationMs).toBe('number');
    expect(replayCesarHarnessLogs({ runsDir, turnId: tracker.turnId }).rendered).toContain('ended: step_budget steps=3/3 sends=1');
  });

  it('does not label an error stop on the last allowed step as step_budget', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    apiStreamDispatchWithHistoryMock.mockImplementation(async function* () {
      return { exitCode: 1, stdout: '', stderr: 'API stream failed: Unauthorized', modelFailure: { retryable: false, outputStarted: false, statusCode: 401 } };
    });
    const session = createResumeSession({
      engine: { id: 'turn-end-stopped', api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'm' } } as any,
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: TOOLS,
      onToolCall: async () => 'ok',
    });
    await session.start();

    const chunks: any[] = [];
    for await (const chunk of session.send({ message: 'go', toolLoopBaseBudget: 1, toolLoopMaxBudget: 1 })) chunks.push(chunk);

    expect(chunks.find((c) => c.type === 'done')?.metadata?.loopEnd).toBe('stopped');
  });

  it('does not report an earlier send\'s error, or an aborted backoff as a retry, on a turn that finished cleanly', () => {
    const tracker = createCesarTurnEndTracker(runsDir);
    tracker.beginSend();
    tracker.observe({ type: 'error', content: 'partial stream failure' });
    tracker.beginSend();
    tracker.observe({ type: 'status', metadata: { kind: 'model-retry', phase: 'waiting', attempt: 1 } });
    tracker.observe({ type: 'done', metadata: { loopEnd: 'completed', step: 1, budget: 15 } });
    tracker.settle({ delegated: false, responded: true, terminalState: 'completed' } as any, false);

    const line = JSON.parse(readFileSync(join(runsDir, 'cesar-tool-timeline.jsonl'), 'utf-8').trim());
    expect(line.status).toBe('completed');
    expect(line.turnId).toBe(tracker.turnId);
    expect(line.summary).toMatchObject({ errorCount: 1, modelRetries: 0 });
    expect(line.summary.error).toBeUndefined();
  });

  it('never persists credentials from a provider error into the turn-end log', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlX3ZhbHVl';
    const leaks = [
      'request failed: Authorization: Basic dXNlcjpwYXNzd29yZA==',
      'upstream said Bearer abcdefghijklmnopqrstuvwx rejected',
      `bad token ${jwt}`,
      'set-cookie: session=topsecretvalue; Path=/',
      'POST https://user:hunter2hunter2@api.example.com/v1 failed',
      'GET https://api.example.com/v1?key=AIzaFakeButLongEnough&x=1 failed',
    ];
    for (const leak of leaks) {
      const scrubbed = summarizeErrorForLog(leak);
      for (const secret of ['dXNlcjpwYXNzd29yZA', 'abcdefghijklmnopqrstuvwx', jwt, 'topsecretvalue', 'hunter2hunter2', 'AIzaFakeButLongEnough']) {
        expect(scrubbed).not.toContain(secret);
      }
    }
  });

  it('does not blame the engine or the user for the wrong stop: watchdog, Esc and API error stay distinct', () => {
    const base = { aborted: false, sendCount: 1, continuationCapHit: false };
    const outcome = (fields: Record<string, unknown>) => ({ delegated: false, responded: false, ...fields }) as any;
    expect(classifyCesarTurnEnd({ ...base, aborted: true, outcome: outcome({ terminalState: 'timed_out' }) })).toBe('watchdog_timeout');
    expect(classifyCesarTurnEnd({ ...base, aborted: true, lastSendEnd: 'api_error', outcome: outcome({ terminalState: 'cancelled' }) })).toBe('abort');
    expect(classifyCesarTurnEnd({ ...base, outcome: outcome({ terminalState: 'failed', decisionReason: 'pre-stream-error' }) })).toBe('api_error');
    expect(classifyCesarTurnEnd({ ...base, lastSendEnd: 'api_error', outcome: outcome({ responded: true, terminalState: 'completed' }) })).toBe('api_error');
    expect(classifyCesarTurnEnd({ ...base, outcome: outcome({ responded: true, agenticTerminalReason: 'no_progress' }) })).toBe('no_progress_checkpoint');
    expect(classifyCesarTurnEnd({ ...base, continuationCapHit: true, outcome: outcome({ responded: true }) })).toBe('continuation_cap');
  });
});
