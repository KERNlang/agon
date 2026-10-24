import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { createDoctorReport, createHostEvent } from '../../packages/mod-kernel/src/host-observability.js';

describe('modular host diagnostics and redaction', () => {
  it('redacts secret values and sensitive keys before an event exists', () => {
    const event = createHostEvent({
      event: 'owner.failed', level: 'error', ownerId: 'agon.mod.example', generation: 3,
      transactionId: 'tx', at: '2026-01-01T00:00:00.000Z',
      details: { message: 'token is swordfish', authorization: 'Bearer value', nested: { value: 'swordfish' } },
    }, ['swordfish']);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('swordfish');
    expect(serialized).not.toContain('Bearer value');
    expect(serialized).toContain('[REDACTED]');
    expect(event.ownerId).toBe('agon.mod.example');
  });

  it('redacts into a fresh object graph without mutating caller-owned values', () => {
    const details = {
      authorization: 'Bearer original',
      nested: { message: 'contains swordfish' },
      list: [{ credential: 'original-credential' }],
    };
    const before = structuredClone(details);
    const event = createHostEvent({
      event: 'owner.failed', level: 'error', ownerId: 'agon.mod.example', generation: 3,
      transactionId: 'tx', at: '2026-01-01T00:00:00.000Z', details,
    }, ['swordfish']);

    expect(details).toEqual(before);
    expect(event.details).not.toBe(details);
    expect(event.details.nested).not.toBe(details.nested);
    expect(event.details.list).not.toBe(details.list);
  });

  it('produces a typed kernel-only Doctor report without importing mods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-doctor-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', secrets: ['private-value'] });
    const report = await host.doctor([{ code: 'load-failed', ownerId: 'agon.mod.bad', message: 'private-value failed', recovery: 'disable the mod' }]);
    expect(report.status).toBe('degraded');
    expect(report.generation).toBeNull();
    expect(JSON.stringify(report)).not.toContain('private-value');
    expect(report.blocked[0]?.ownerId).toBe('agon.mod.bad');
  });

  it('keeps report structure stable under recursive redaction', () => {
    const report = createDoctorReport({ status: 'safe-mode', generation: 2, graphHash: null, reason: null, journalRecovery: ['tx'], blocked: [], failures: [] }, []);
    expect(report).toEqual({ schemaVersion: 1, status: 'safe-mode', generation: 2, graphHash: null, reason: null, journalRecovery: ['tx'], blocked: [], failures: [] });
  });
});
