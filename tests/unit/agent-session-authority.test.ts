import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const stream = vi.hoisted(() => vi.fn());
vi.mock('../../packages/core/src/api/dispatch.js', () => ({ apiStreamDispatchWithHistory: stream }));
import { AgentSession } from '../../packages/core/src/cesar/agent-session.js';
import { AgentSession as OwnedAgentSession } from '@kernlang/agon-support-agent-runtime';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'agon-session-authority-')); stream.mockReset(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it.each(['healthy', 'entry', 'provider', 'approval', 'next-turn'])(
  'enforces authority through the real session and tool loop: %s', async boundary => {
    let refused = boundary === 'entry';
    const workspace = join(root, 'workspace');
    mkdirSync(workspace);
    let calls = 0;
    stream.mockImplementation(async function* () {
      calls++;
      if (boundary === 'provider') refused = true;
      if (calls === 1) yield '<tool name="Write">{"file_path":"../result.txt","content":"fixture"}</tool>';
      else yield 'done';
      return { exitCode: 0 };
    });
    const approve = vi.fn(async () => { if (boundary === 'approval') refused = true; return true; });
    const session = new AgentSession({
      engineId: 'fixture',
      api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' },
      cwd: workspace, budget: { maxTurns: 3, maxDurationMs: 120_000 },
      maxInnerSteps: 3, permissionMode: 'ask', toolPermissions: { Write: 'ask' },
      onPermissionAsk: approve,
      executionRefusal: () => refused ? 'Owner disabled' : undefined,
    });
    const first = await session.step('write fixture');
    const firstAllowed = boundary === 'healthy' || boundary === 'next-turn';
    expect(first.stopReason).toBe(firstAllowed ? 'completed' : 'error');
    expect(existsSync(join(root, 'result.txt'))).toBe(firstAllowed);
    expect(first.engineFault).not.toBe(true);
    expect(stream).toHaveBeenCalledTimes(firstAllowed ? 2 : boundary === 'entry' ? 0 : 1);
    expect(approve).toHaveBeenCalledTimes(firstAllowed || boundary === 'approval' ? 1 : 0);
    if (boundary === 'next-turn') {
      refused = true;
      const second = await session.step('continue');
      expect(second).toMatchObject({ stopReason: 'error', error: 'Owner disabled', engineFault: false });
      expect(stream).toHaveBeenCalledTimes(2);
      expect(session.getStats().state).toBe('failed');
    }
  },
);

it.each(['healthy', 'entry', 'entry-empty', 'entry-throw', 'loop-return', 'save-return', 'cancel'])(
  'guards session-owned continuity and completion: %s', async boundary => {
    let refused = boundary.startsWith('entry');
    let releaseSave!: () => void;
    let startedSave!: () => void;
    const savePending = new Promise<void>(resolve => { releaseSave = resolve; });
    const saveStarted = new Promise<void>(resolve => { startedSave = resolve; });
    const thread = {
      messagesFor: vi.fn(() => []), appendLoopEntry: vi.fn(), markSeen: vi.fn(),
      save: vi.fn(async () => {
        if (boundary === 'save-return') { startedSave(); await savePending; }
      }),
      saveSync: vi.fn(),
    };
    const runApiAgentLoop = vi.fn(async () => {
      if (boundary === 'loop-return') refused = true;
      return { response: 'done', toolCalls: 2, steps: 1 };
    });
    const session = new OwnedAgentSession({
      engineId: 'fixture', cwd: root, thread,
      api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' },
      budget: { maxTurns: 3, maxDurationMs: 120_000 },
      executionRefusal: () => {
        if (boundary === 'entry-throw') throw new Error('private authority detail');
        return refused ? (boundary === 'entry-empty' ? '' : 'Owner disabled') : undefined;
      },
    }, {
      runApiAgentLoop, estimateTokens: () => 10, estimateCost: () => 0.1,
      makeAssistantChunk: () => ({}), makeToolCall: () => ({}),
    });
    if (boundary === 'cancel') {
      refused = true;
      session.cancel();
      expect(session.getSignal().aborted).toBe(true);
      expect(thread.markSeen).not.toHaveBeenCalled();
      expect(thread.saveSync).not.toHaveBeenCalled();
      return;
    }
    const pending = session.step('fixture');
    if (boundary === 'save-return') {
      await saveStarted;
      refused = true;
      releaseSave();
    }
    const result = await pending;
    expect(result.stopReason).toBe(boundary === 'healthy' ? 'completed' : 'error');
    if (boundary !== 'healthy') expect(result).toMatchObject({
      error: boundary === 'entry-throw' ? 'Execution authority check failed' : boundary === 'entry-empty' ? '' : 'Owner disabled',
      engineFault: false,
    });
    const ran = !boundary.startsWith('entry');
    expect(runApiAgentLoop).toHaveBeenCalledTimes(ran ? 1 : 0);
    expect(thread.messagesFor).toHaveBeenCalledTimes(ran ? 1 : 0);
    const persisted = boundary === 'healthy' || boundary === 'save-return';
    expect(thread.markSeen).toHaveBeenCalledTimes(persisted ? 1 : 0);
    expect(thread.save).toHaveBeenCalledTimes(persisted ? 1 : 0);
    expect(session.getStats()).toMatchObject({
      state: boundary === 'healthy' ? 'idle' : 'failed',
      turnsUsed: ran ? 1 : 0, tokensUsed: ran ? 20 : 0,
      totalToolCalls: ran ? 2 : 0, totalCostUsd: ran ? 0.1 : 0,
    });
  },
);
