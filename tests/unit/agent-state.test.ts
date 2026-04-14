import { describe, it, expect } from 'vitest';
import {
  createAgentState, beginTurn, completeTurn, requestApproval, approveTool, rejectTool,
  cancelAgent, failAgent, completeAgent, checkBudget, isTerminal,
} from '../../packages/core/src/generated/cesar/agent-state.js';
import type { AgentState, AgentBudget, AgentStepResult } from '../../packages/core/src/generated/cesar/agent-state.js';

const BUDGET: AgentBudget = { maxTurns: 5, maxTokens: 100_000, maxDurationMs: 60_000 };
const T0 = 1_000_000;

function ok(tokens = 50, toolCalls = 1): AgentStepResult {
  return {
    response: 'done',
    toolCalls,
    innerSteps: 2,
    tokensUsed: tokens,
    costUsd: 0.01,
    stopReason: 'completed',
  };
}

describe('agent-state reducers', () => {
  describe('createAgentState', () => {
    it('seeds idle phase with empty history when no system prompt', () => {
      const s = createAgentState('claude', BUDGET, undefined, T0);
      expect(s.phase.kind).toBe('idle');
      expect(s.context.history).toEqual([]);
      expect(s.context.turns).toEqual([]);
      expect(s.context.cumulativeTokens).toBe(0);
      expect(s.context.startedAt).toBe(T0);
    });

    it('seeds history with system message when provided', () => {
      const s = createAgentState('claude', BUDGET, 'You are helpful', T0);
      expect(s.context.history).toHaveLength(1);
      expect(s.context.history[0]).toMatchObject({ role: 'system', content: 'You are helpful' });
    });
  });

  describe('beginTurn', () => {
    it('transitions idle → running and appends user message', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = beginTurn(s0, 'hello', T0 + 100);
      expect(s1.phase.kind).toBe('running');
      if (s1.phase.kind === 'running') {
        expect(s1.phase.turnIndex).toBe(0);
        expect(s1.phase.turnStartedAt).toBe(T0 + 100);
      }
      expect(s1.context.history).toHaveLength(1);
      expect(s1.context.history[0]).toMatchObject({ role: 'user', content: 'hello' });
    });

    it('is a no-op in terminal phases', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = cancelAgent(s0, 'user cancelled');
      const s2 = beginTurn(s1, 'hello');
      expect(s2).toBe(s1);
    });

    it('is a no-op when already running', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = beginTurn(s0, 'first', T0 + 100);
      const s2 = beginTurn(s1, 'second', T0 + 200);
      expect(s2).toBe(s1);
    });
  });

  describe('completeTurn', () => {
    it('records turn, appends assistant message, updates cumulative stats, returns to idle', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = beginTurn(s0, 'hello', T0 + 100);
      const s2 = completeTurn(s1, 'hello', ok(120, 3), T0 + 5_000);

      expect(s2.phase.kind).toBe('idle');
      expect(s2.context.turns).toHaveLength(1);
      expect(s2.context.turns[0]).toMatchObject({
        index: 0,
        userPrompt: 'hello',
        assistantResponse: 'done',
        toolCalls: 3,
        tokensUsed: 120,
        startedAt: T0 + 100,
        completedAt: T0 + 5_000,
        outcome: 'completed',
      });
      expect(s2.context.cumulativeTokens).toBe(120);
      expect(s2.context.cumulativeToolCalls).toBe(3);
      expect(s2.context.history).toHaveLength(2);
      expect(s2.context.history[1]).toMatchObject({ role: 'assistant', content: 'done' });
    });

    it('accumulates across multiple turns', () => {
      let s = createAgentState('claude', BUDGET, undefined, T0);
      s = beginTurn(s, 'a', T0 + 1);
      s = completeTurn(s, 'a', ok(100, 2), T0 + 100);
      s = beginTurn(s, 'b', T0 + 200);
      s = completeTurn(s, 'b', ok(200, 5), T0 + 300);

      expect(s.context.turns).toHaveLength(2);
      expect(s.context.cumulativeTokens).toBe(300);
      expect(s.context.cumulativeToolCalls).toBe(7);
    });

    it('transitions to failed when result.stopReason=budget_exceeded', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = beginTurn(s0, 'hello', T0 + 100);
      const s2 = completeTurn(s1, 'hello', {
        response: '',
        toolCalls: 0,
        innerSteps: 0,
        tokensUsed: 0,
        costUsd: 0,
        stopReason: 'budget_exceeded',
        error: 'Turn budget exceeded: 5/5',
      }, T0 + 200);
      expect(s2.phase.kind).toBe('failed');
      if (s2.phase.kind === 'failed') expect(s2.phase.reason).toBe('budget_turns');
    });

    it('transitions to cancelled when result.stopReason=cancelled', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = beginTurn(s0, 'hello', T0 + 100);
      const s2 = completeTurn(s1, 'hello', {
        response: 'partial',
        toolCalls: 1,
        innerSteps: 1,
        tokensUsed: 10,
        costUsd: 0,
        stopReason: 'cancelled',
        error: 'aborted',
      }, T0 + 200);
      expect(s2.phase.kind).toBe('cancelled');
    });

    it('is a no-op when not running', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = completeTurn(s0, 'hello', ok(), T0 + 100);
      expect(s1).toBe(s0);
    });
  });

  describe('approval flow', () => {
    it('requestApproval transitions running → awaiting_approval carrying pending tool payload', () => {
      let s: AgentState = createAgentState('claude', BUDGET, undefined, T0);
      s = beginTurn(s, 'read file', T0 + 100);
      s = requestApproval(s, 'Bash', { command: 'rm -rf /' }, 'call_123');

      expect(s.phase.kind).toBe('awaiting_approval');
      if (s.phase.kind === 'awaiting_approval') {
        expect(s.phase.pendingToolName).toBe('Bash');
        expect(s.phase.pendingToolInput).toEqual({ command: 'rm -rf /' });
        expect(s.phase.pendingToolCallId).toBe('call_123');
      }
    });

    it('approveTool transitions back to running', () => {
      let s: AgentState = createAgentState('claude', BUDGET, undefined, T0);
      s = beginTurn(s, 'do', T0 + 100);
      s = requestApproval(s, 'Bash', { command: 'ls' }, 'call_1');
      s = approveTool(s, T0 + 200);
      expect(s.phase.kind).toBe('running');
    });

    it('rejectTool transitions back to running and records refusal in history', () => {
      let s: AgentState = createAgentState('claude', BUDGET, undefined, T0);
      s = beginTurn(s, 'do', T0 + 100);
      const historyBefore = s.context.history.length;
      s = requestApproval(s, 'Bash', { command: 'rm -rf /' }, 'call_1');
      s = rejectTool(s, 'destructive command', T0 + 200);

      expect(s.phase.kind).toBe('running');
      expect(s.context.history.length).toBe(historyBefore + 1);
      const refusal = s.context.history[s.context.history.length - 1];
      expect(refusal.role).toBe('tool');
      expect(refusal.content).toContain('destructive command');
      expect(refusal.toolCallId).toBe('call_1');
    });
  });

  describe('terminal transitions', () => {
    it('cancelAgent transitions any non-terminal phase to cancelled', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = beginTurn(s0, 'go', T0 + 100);
      const s2 = cancelAgent(s1, 'user hit ctrl+c');
      expect(s2.phase.kind).toBe('cancelled');
      if (s2.phase.kind === 'cancelled') expect(s2.phase.reason).toBe('user hit ctrl+c');
    });

    it('cancelAgent is idempotent over terminal phases', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = completeAgent(s0, 'final');
      const s2 = cancelAgent(s1, 'too late');
      expect(s2).toBe(s1);
    });

    it('failAgent transitions to failed with reason code', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = failAgent(s0, 'error', 'network down');
      expect(s1.phase.kind).toBe('failed');
      if (s1.phase.kind === 'failed') {
        expect(s1.phase.reason).toBe('error');
        expect(s1.phase.errorMessage).toBe('network down');
      }
    });

    it('completeAgent requires idle and sets finalResponse', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = completeAgent(s0, 'final answer');
      expect(s1.phase.kind).toBe('completed');
      if (s1.phase.kind === 'completed') expect(s1.phase.finalResponse).toBe('final answer');
    });

    it('completeAgent is a no-op when not idle', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = beginTurn(s0, 'go', T0 + 100);
      const s2 = completeAgent(s1, 'forced');
      expect(s2).toBe(s1);
    });
  });

  describe('checkBudget', () => {
    it('returns null when within budget', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      expect(checkBudget(s0, T0)).toBeNull();
    });

    it('returns failed state when turn budget exhausted', () => {
      let s = createAgentState('claude', { maxTurns: 1, maxDurationMs: 60_000 }, undefined, T0);
      s = beginTurn(s, 'only', T0 + 1);
      s = completeTurn(s, 'only', ok(), T0 + 100);
      const blocked = checkBudget(s, T0 + 200);
      expect(blocked).not.toBeNull();
      expect(blocked!.phase.kind).toBe('failed');
      if (blocked!.phase.kind === 'failed') expect(blocked!.phase.reason).toBe('budget_turns');
    });

    it('returns failed state when token budget exhausted', () => {
      let s = createAgentState('claude', { maxTurns: 10, maxTokens: 50, maxDurationMs: 60_000 }, undefined, T0);
      s = beginTurn(s, 'go', T0 + 1);
      s = completeTurn(s, 'go', ok(100, 0), T0 + 100);
      const blocked = checkBudget(s, T0 + 200);
      expect(blocked!.phase.kind).toBe('failed');
      if (blocked!.phase.kind === 'failed') expect(blocked!.phase.reason).toBe('budget_tokens');
    });

    it('returns failed state when duration budget exhausted', () => {
      const s0 = createAgentState('claude', { maxTurns: 10, maxDurationMs: 1000 }, undefined, T0);
      const blocked = checkBudget(s0, T0 + 5000);
      expect(blocked!.phase.kind).toBe('failed');
      if (blocked!.phase.kind === 'failed') expect(blocked!.phase.reason).toBe('budget_duration');
    });

    it('returns null for already-terminal states', () => {
      const s0 = createAgentState('claude', BUDGET, undefined, T0);
      const s1 = completeAgent(s0, 'done');
      expect(checkBudget(s1, T0 + 10_000)).toBeNull();
    });
  });

  describe('isTerminal', () => {
    it.each([
      ['idle', false],
      ['running', false],
      ['awaiting_approval', false],
      ['completed', true],
      ['failed', true],
      ['cancelled', true],
    ] as const)('returns %s → %s', (kind, expected) => {
      let s: AgentState = createAgentState('claude', BUDGET, undefined, T0);
      if (kind === 'running') s = beginTurn(s, 'go', T0 + 1);
      else if (kind === 'awaiting_approval') {
        s = beginTurn(s, 'go', T0 + 1);
        s = requestApproval(s, 'Bash', {}, 'id1');
      } else if (kind === 'completed') s = completeAgent(s, 'done');
      else if (kind === 'failed') s = failAgent(s, 'error', 'bad');
      else if (kind === 'cancelled') s = cancelAgent(s, 'user');
      expect(isTerminal(s)).toBe(expected);
    });
  });
});
