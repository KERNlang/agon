import { describe, expect, it } from 'vitest';
import {
  controlPlaneIdentity,
  isCurrentControlPlaneEnvelope,
  isTerminalTurnState,
  reduceTurnLifecycle,
  validateControlPlaneEnvelope,
} from '../../packages/core/src/generated/sessions/turn-protocol.js';

const envelope = {
  schemaVersion: 1 as const,
  sessionId: 'session-1',
  turnId: 'turn-1',
  leaseEpoch: 3,
  attempt: 1,
  producerId: 'api-session',
};

describe('control-plane envelope', () => {
  it('accepts a valid v1 envelope and preserves optional identities', () => {
    const result = validateControlPlaneEnvelope({
      ...envelope,
      stepId: 'step-2',
      toolCallId: 'tool-4',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        ...envelope,
        stepId: 'step-2',
        toolCallId: 'tool-4',
      },
    });
    expect(controlPlaneIdentity(result.ok ? result.value : envelope)).toBe(
      'session-1:turn-1:3:1:api-session:step-2:tool-4',
    );
  });

  it('rejects malformed, unknown-version, and non-positive epoch data', () => {
    expect(validateControlPlaneEnvelope(null).ok).toBe(false);
    expect(validateControlPlaneEnvelope({ ...envelope, schemaVersion: 2 }).ok).toBe(false);
    expect(validateControlPlaneEnvelope({ ...envelope, leaseEpoch: 0 }).ok).toBe(false);
    expect(validateControlPlaneEnvelope({ ...envelope, attempt: -1 }).ok).toBe(false);
    expect(validateControlPlaneEnvelope({ ...envelope, producerId: '' }).ok).toBe(false);
  });

  it('fences stale turns, epochs, attempts, and producers', () => {
    expect(isCurrentControlPlaneEnvelope(envelope, envelope)).toBe(true);
    expect(isCurrentControlPlaneEnvelope({ ...envelope, turnId: 'turn-old' }, envelope)).toBe(false);
    expect(isCurrentControlPlaneEnvelope({ ...envelope, leaseEpoch: 2 }, envelope)).toBe(false);
    expect(isCurrentControlPlaneEnvelope({ ...envelope, attempt: 0 }, envelope)).toBe(false);
    expect(isCurrentControlPlaneEnvelope({ ...envelope, producerId: 'pty-session' }, envelope)).toBe(false);
  });
});

describe('turn lifecycle reducer', () => {
  it('allows only protocol-defined transitions', () => {
    expect(reduceTurnLifecycle('created', 'running')).toEqual({ ok: true, state: 'running' });
    expect(reduceTurnLifecycle('running', 'cancelling')).toEqual({ ok: true, state: 'cancelling' });
    expect(reduceTurnLifecycle('cancelling', 'cancelled')).toEqual({ ok: true, state: 'cancelled' });
    expect(reduceTurnLifecycle('running', 'completed')).toEqual({ ok: true, state: 'completed' });
    expect(reduceTurnLifecycle('running', 'failed')).toEqual({ ok: true, state: 'failed' });
    expect(reduceTurnLifecycle('running', 'timed_out')).toEqual({ ok: true, state: 'timed_out' });
    expect(reduceTurnLifecycle('running', 'superseded')).toEqual({ ok: true, state: 'superseded' });
  });

  it('rejects skipped states and any transition out of a terminal state', () => {
    expect(reduceTurnLifecycle('created', 'completed')).toEqual({
      ok: false,
      state: 'created',
      reason: 'invalid_transition',
    });
    expect(reduceTurnLifecycle('completed', 'running')).toEqual({
      ok: false,
      state: 'completed',
      reason: 'terminal_state',
    });
    expect(reduceTurnLifecycle('cancelling', 'completed')).toEqual({
      ok: false,
      state: 'cancelling',
      reason: 'invalid_transition',
    });
  });

  it('identifies every terminal lifecycle state', () => {
    expect(['completed', 'failed', 'timed_out', 'superseded', 'cancelled'].every(isTerminalTurnState)).toBe(true);
    expect(isTerminalTurnState('running')).toBe(false);
    expect(isTerminalTurnState('cancelling')).toBe(false);
  });
});
