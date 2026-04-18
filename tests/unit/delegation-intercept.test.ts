import { describe, it, expect } from 'vitest';

/**
 * Tests the orchestration tool interception logic from handlers-cesar-brain.
 *
 * The real handler is deeply coupled to engine sessions, so we extract and
 * test the interception logic directly: when onToolCall receives an
 * orchestration tool name, it sets ctx._pendingDelegation.
 */

const ORCHESTRATION_TOOLS = new Set(['Forge', 'Brainstorm', 'Tribunal', 'Campfire', 'Pipeline']);

/**
 * Extracted interception logic — mirrors the onToolCall body in
 * handlers-cesar-brain.ts (lines 568-583).
 */
function simulateOnToolCall(
  ctx: Record<string, unknown>,
  name: string,
  inp: Record<string, unknown>,
) {
  if (ORCHESTRATION_TOOLS.has(name)) {
    const task = (inp as any).task ?? (inp as any).question ?? (inp as any).topic ?? '';
    (ctx as any)._pendingDelegation = {
      action: name.toLowerCase(),
      task,
      reasoning: task,
      fitnessCmd: typeof (inp as any).fitnessCmd === 'string'
        ? (inp as any).fitnessCmd
        : typeof (inp as any).fitness === 'string'
          ? (inp as any).fitness
          : undefined,
      hardened: (inp as any).hardened ?? false,
      tribunalMode: (inp as any).mode,
      team: (inp as any).team ?? false,
      createdAt: Date.now(),
    };
  }
}

describe('delegation intercept', () => {
  it('sets _pendingDelegation for Forge tool', () => {
    const ctx: Record<string, unknown> = {};
    simulateOnToolCall(ctx, 'Forge', { task: 'fix auth bug', fitness: 'npm test' });

    expect(ctx._pendingDelegation).toBeDefined();
    const del = ctx._pendingDelegation as any;
    expect(del.action).toBe('forge');
    expect(del.task).toBe('fix auth bug');
    expect(del.reasoning).toBe('fix auth bug');
    expect(del.fitnessCmd).toBe('npm test');
    expect(del.hardened).toBe(false);
    expect(del.team).toBe(false);
    expect(del.createdAt).toBeGreaterThan(0);
  });

  it('sets _pendingDelegation for Brainstorm tool', () => {
    const ctx: Record<string, unknown> = {};
    simulateOnToolCall(ctx, 'Brainstorm', { topic: 'auth architecture' });

    const del = ctx._pendingDelegation as any;
    expect(del.action).toBe('brainstorm');
    expect(del.task).toBe('auth architecture');
    expect(del.reasoning).toBe('auth architecture');
  });

  it('sets _pendingDelegation for Tribunal tool with mode', () => {
    const ctx: Record<string, unknown> = {};
    simulateOnToolCall(ctx, 'Tribunal', { question: 'REST vs GraphQL', mode: 'adversarial' });

    const del = ctx._pendingDelegation as any;
    expect(del.action).toBe('tribunal');
    expect(del.task).toBe('REST vs GraphQL');
    expect(del.reasoning).toBe('REST vs GraphQL');
    expect(del.tribunalMode).toBe('adversarial');
  });

  it('sets _pendingDelegation for Campfire tool', () => {
    const ctx: Record<string, unknown> = {};
    simulateOnToolCall(ctx, 'Campfire', { topic: 'monorepo structure', team: true });

    const del = ctx._pendingDelegation as any;
    expect(del.action).toBe('campfire');
    expect(del.task).toBe('monorepo structure');
    expect(del.reasoning).toBe('monorepo structure');
    expect(del.team).toBe(true);
  });

  it('sets _pendingDelegation for Pipeline tool', () => {
    const ctx: Record<string, unknown> = {};
    simulateOnToolCall(ctx, 'Pipeline', { task: 'deploy staging' });

    const del = ctx._pendingDelegation as any;
    expect(del.action).toBe('pipeline');
    expect(del.task).toBe('deploy staging');
    expect(del.reasoning).toBe('deploy staging');
  });

  it('sets hardened flag when provided', () => {
    const ctx: Record<string, unknown> = {};
    simulateOnToolCall(ctx, 'Forge', { task: 'critical fix', hardened: true });

    const del = ctx._pendingDelegation as any;
    expect(del.hardened).toBe(true);
  });

  it('does NOT set _pendingDelegation for Read tool', () => {
    const ctx: Record<string, unknown> = {};
    simulateOnToolCall(ctx, 'Read', { file_path: '/src/index.ts' });

    expect(ctx._pendingDelegation).toBeUndefined();
  });

  it('does NOT set _pendingDelegation for Bash tool', () => {
    const ctx: Record<string, unknown> = {};
    simulateOnToolCall(ctx, 'Bash', { command: 'npm test' });

    expect(ctx._pendingDelegation).toBeUndefined();
  });

  it('does NOT set _pendingDelegation for Edit tool', () => {
    const ctx: Record<string, unknown> = {};
    simulateOnToolCall(ctx, 'Edit', { file_path: '/src/index.ts', old_string: 'a', new_string: 'b' });

    expect(ctx._pendingDelegation).toBeUndefined();
  });

  it('does NOT set _pendingDelegation for Grep tool', () => {
    const ctx: Record<string, unknown> = {};
    simulateOnToolCall(ctx, 'Grep', { pattern: 'TODO' });

    expect(ctx._pendingDelegation).toBeUndefined();
  });

  it('uses task field for reasoning, falling back to question then topic', () => {
    const ctx1: Record<string, unknown> = {};
    simulateOnToolCall(ctx1, 'Forge', { task: 'primary', question: 'fallback', topic: 'last' });
    expect((ctx1._pendingDelegation as any).task).toBe('primary');
    expect((ctx1._pendingDelegation as any).reasoning).toBe('primary');

    const ctx2: Record<string, unknown> = {};
    simulateOnToolCall(ctx2, 'Tribunal', { question: 'fallback', topic: 'last' });
    expect((ctx2._pendingDelegation as any).task).toBe('fallback');
    expect((ctx2._pendingDelegation as any).reasoning).toBe('fallback');

    const ctx3: Record<string, unknown> = {};
    simulateOnToolCall(ctx3, 'Campfire', { topic: 'last' });
    expect((ctx3._pendingDelegation as any).task).toBe('last');
    expect((ctx3._pendingDelegation as any).reasoning).toBe('last');

    const ctx4: Record<string, unknown> = {};
    simulateOnToolCall(ctx4, 'Brainstorm', {});
    expect((ctx4._pendingDelegation as any).task).toBe('');
    expect((ctx4._pendingDelegation as any).reasoning).toBe('');
  });
});
