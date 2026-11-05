import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RUNS_DIR, startChatSession } from '@kernlang/agon-core';
import { handleCesarBrain } from '../../packages/cli/src/cesar/brain.js';

const { budget, ensure, backend, toolLoop } = vi.hoisted(() => ({ budget: vi.fn(), ensure: vi.fn(), backend: vi.fn(), toolLoop: vi.fn() }));
vi.mock('@kernlang/agon-core', async (original) => ({ ...await original<object>(), runToolLoop: toolLoop }));
vi.mock('../../packages/cli/src/cesar/context-budget.js', async (original) => ({
  ...await original<object>(), enforceContextBudget: budget,
}));
vi.mock('../../packages/cli/src/cesar/session.js', async (original) => ({
  ...await original<object>(), ensureCesarSession: ensure, resolveCesarBackend: backend, buildCesarSystemPrompt: () => 'fixture system prompt',
}));

function fixture(chunks: Array<Record<string, unknown>>) {
  const session: any = {
    alive: true,
    engineId: 'fixture',
    close: vi.fn(),
    send: vi.fn(async function* () { for (const chunk of chunks) yield chunk; }),
  };
  ensure.mockResolvedValue(session);
  const ctx: any = {
    config: { cesarEngine: 'fixture', cesarToolTimeline: false, cesarStreamingXmlTools: false },
    chatSession: startChatSession(),
    cesarSession: session,
    adapter: { dispatch: vi.fn() },
    registry: { get: vi.fn(() => ({ id: 'fixture' })) },
    activeEngines: () => ['fixture'],
    setActiveAbort: vi.fn(),
  };
  ctx.setCesarSession = vi.fn((value: unknown) => { ctx.cesarSession = value; });
  return { session, ctx, dispatch: vi.fn() };
}

const warnings = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls.map(([event]) => event).filter((event) => event?.type === 'warning').map((event) => String(event.message));

function turnEndLine(turnId: string) {
  return readFileSync(join(RUNS_DIR, 'cesar-tool-timeline.jsonl'), 'utf-8')
    .trim().split('\n').map((line) => JSON.parse(line))
    .find((record) => record.turnId === turnId && record.event === 'turn_end');
}

beforeEach(() => {
  budget.mockReset().mockResolvedValue({ proceed: true, compacted: false });
  backend.mockReset().mockReturnValue({ backend: 'api', engine: { id: 'fixture' } });
  toolLoop.mockReset().mockResolvedValue({ finalResponse: '', totalToolCalls: 0, turns: 0 });
});

describe('Cesar brain after a model stream failure', () => {
  it('does not run tool markup that was already streamed before the stream failed', async () => {
    const { session, ctx, dispatch } = fixture([
      { type: 'text', content: 'Checking.\n<tool name="Bash">{"command":"touch /tmp/never"}</tool>\n' },
      { type: 'error', content: 'Stream failed after output started, not retried: terminated', metadata: { modelRetryFinal: true, outputStarted: true } },
    ]);

    await handleCesarBrain('go', dispatch, ctx, []);

    expect(toolLoop).not.toHaveBeenCalled();
    expect(session.send).toHaveBeenCalledOnce();
    expect(warnings(dispatch).join('\n')).toMatch(/stream error/i);
  });

  it('does not tell the user an exhausted 429 is a config or auth problem, and logs it as api_error', async () => {
    const { ctx, dispatch } = fixture([
      { type: 'error', content: 'Gave up after 5 retries, 62s waited: API rate limited (retries exhausted): status 429', metadata: { modelRetryFinal: true, statusCode: 429, modelRetries: 5 } },
    ]);

    const outcome = await handleCesarBrain('go', dispatch, ctx, []);

    const warning = warnings(dispatch).join('\n');
    expect(warning).not.toMatch(/config\/auth/);
    expect(warning).toMatch(/gave up after 5 retries/i);
    expect(outcome.deterministicFailure).toBe(true);
    expect(turnEndLine(String(outcome.turnId))).toMatchObject({ status: 'api_error', summary: { endReason: 'api_error', errorKind: 'rate_limit' } });
  });

  it('reports an Esc after the watchdog window as a cancel, not a timeout', async () => {
    const parent = new AbortController();
    const { session, ctx, dispatch } = fixture([]);
    ctx.config.cesarTimeout = 0;
    session.send = vi.fn(async function* () {
      yield { type: 'text', content: 'working' };
      parent.abort();
      yield { type: 'text', content: ' more' };
    });

    const outcome = await handleCesarBrain('go', dispatch, ctx, [], parent.signal);

    expect(outcome.terminalState).toBe('cancelled');
    expect(warnings(dispatch).join('\n')).not.toMatch(/timed out/);
  });

  it('still calls a 401 a config or auth problem', async () => {
    const { ctx, dispatch } = fixture([
      { type: 'error', content: 'API stream failed: Unauthorized', metadata: { modelRetryFinal: true, statusCode: 401, modelRetries: 0 } },
    ]);

    await handleCesarBrain('go', dispatch, ctx, []);

    expect(warnings(dispatch).join('\n')).toMatch(/config\/auth/);
  });
});
