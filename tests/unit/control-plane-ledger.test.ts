import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  appendControlPlaneEvent,
  recoverControlPlane,
} from '../../packages/core/src/generated/sessions/control-plane-ledger.js';
import { resetEventLogState } from '../../packages/core/src/generated/sessions/event-log.js';

let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-control-ledger-'));
  process.env.AGON_HOME = home;
  resetEventLogState();
});

afterEach(() => {
  resetEventLogState();
  delete process.env.AGON_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('control-plane durable recovery', () => {
  it('never marks an unterminated mutation/external/unknown claim retryable', () => {
    const sid = 'chat-ledger-1';
    expect(appendControlPlaneEvent(sid, {
      type: 'turn_started', envelope: { schemaVersion: 1, sessionId: sid, turnId: 't1', leaseEpoch: 4, attempt: 1, producerId: 'brain' },
    }).ok).toBe(true);
    for (const [toolCallId, effectClass] of [['mutation-1', 'mutation'], ['external-1', 'external'], ['unknown-1', 'unknown']] as const) {
      expect(appendControlPlaneEvent(sid, { type: 'tool_claimed', toolCallId, effectClass }).ok).toBe(true);
    }

    const recovered = recoverControlPlane(sid);
    expect(recovered.nextLeaseEpoch).toBe(5);
    expect(recovered.retryableReadOnly).toEqual([]);
    expect(recovered.needsInspection).toEqual(['mutation-1', 'external-1', 'unknown-1']);
  });

  it('offers only an unterminated read-only claim for explicit retry', () => {
    const sid = 'chat-ledger-2';
    appendControlPlaneEvent(sid, { type: 'tool_claimed', toolCallId: 'read-1', effectClass: 'read_only' });
    appendControlPlaneEvent(sid, { type: 'tool_claimed', toolCallId: 'read-done', effectClass: 'read_only' });
    appendControlPlaneEvent(sid, { type: 'tool_terminal', toolCallId: 'read-done', terminalReason: 'succeeded' });

    expect(recoverControlPlane(sid).retryableReadOnly).toEqual(['read-1']);
  });

  it('does not let an older lease terminal mask a reused tool id in a newer lease', () => {
    const sid = 'chat-ledger-epoch-scope';
    const envelope = (turnId: string, leaseEpoch: number) => ({
      schemaVersion: 1, sessionId: sid, turnId, leaseEpoch, attempt: 1, producerId: 'brain',
    });
    appendControlPlaneEvent(sid, {
      type: 'tool_claimed', envelope: envelope('turn-1', 1), toolCallId: 'shared-id', effectClass: 'mutation',
    });
    appendControlPlaneEvent(sid, {
      type: 'tool_terminal', envelope: envelope('turn-1', 1), toolCallId: 'shared-id', terminalReason: 'succeeded',
    });
    appendControlPlaneEvent(sid, {
      type: 'tool_claimed', envelope: envelope('turn-2', 2), toolCallId: 'shared-id', effectClass: 'mutation',
    });

    expect(recoverControlPlane(sid).needsInspection).toEqual(['shared-id']);
  });

  it('fails closed for an unknown control-plane schema without blocking legacy events', () => {
    const sid = 'chat-ledger-3';
    appendControlPlaneEvent(sid, { type: 'turn_started', schemaVersion: 2 });
    const recovered = recoverControlPlane(sid);
    expect(recovered.unsupportedSchema).toBe(true);
    expect(recovered.retryableReadOnly).toEqual([]);
  });
});
