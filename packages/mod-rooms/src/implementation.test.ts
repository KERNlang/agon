import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InvocationContext, ModServices } from '@kernlang/agon-mod-api';

import { roomAction } from './implementation.js';

const originalHome = process.env.AGON_HOME;
const temporaryHomes: string[] = [];

function isolatedHome(): void {
  const directory = mkdtempSync(join(tmpdir(), 'rooms-'));
  temporaryHomes.push(directory);
  process.env.AGON_HOME = directory;
}

afterEach(() => {
  for (const directory of temporaryHomes.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  if (originalHome === undefined) delete process.env.AGON_HOME;
  else process.env.AGON_HOME = originalHome;
});

function context(signal: AbortSignal = new AbortController().signal): InvocationContext {
  return {
    invocationId: 'room-test',
    cwd: process.cwd(),
    platform: 'darwin-arm64',
    signal,
    config: {},
  };
}

function service(permission = 'allow'): ModServices {
  return {
    identity: { id: 'agon.rooms', version: '1.0.0', contentHash: `sha256:${'0'.repeat(64)}` },
    source: 'bundled',
    permissions: { check: vi.fn(async () => permission as 'allow' | 'deny') },
    receipts: { record: vi.fn(async () => 'receipt-room') },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    state: { read: vi.fn(), write: vi.fn() },
    engines: {
      listActive: vi.fn(async () => ['codex']),
      dispatch: vi.fn(async () => ({ stdout: 'engine reply', exitCode: 0 })),
    },
  } as unknown as ModServices;
}

describe('physical rooms mod', () => {
  it('creates, posts, reads, tracks presence, and enforces resource leases', async () => {
    isolatedHome();
    await roomAction({ action: 'join', room: 'My Room', callsign: 'a' }, context(), service());
    expect((await roomAction({ action: 'post', room: 'my-room', callsign: 'a', text: 'hi @b' }, context(), service()) as any).mentions).toEqual(['b']);
    expect((await roomAction({ action: 'read', room: 'my-room' }, context(), service()) as any).events).toHaveLength(2);
    await roomAction({ action: 'lock', room: 'my-room', callsign: 'a', resource: 'x' }, context(), service());
    await expect(roomAction({ action: 'lock', room: 'my-room', callsign: 'b', resource: 'x' }, context(), service())).rejects.toThrow('held by a');
    expect((await roomAction({ action: 'who', room: 'my-room' }, context(), service()) as any).present[0].callsign).toBe('a');
  });

  it('preserves unread cursors, tasks, targeted claims, and stop events', async () => {
    isolatedHome();
    const services = service();
    await roomAction({ action: 'join', room: 'r', callsign: 'boss' }, context(), services);
    await roomAction({ action: 'post', room: 'r', callsign: 'boss', text: '@worker begin' }, context(), services);
    const unread = await roomAction({ action: 'read', room: 'r', callsign: 'worker', unread: true }, context(), services) as any;
    expect(unread.cursorAdvanced).toBe(true);
    expect(unread.lastReadSeq).toBe(2);
    const task = await roomAction({ action: 'task', room: 'r', callsign: 'boss', text: 'build it', for: 'worker' }, context(), services) as any;
    expect(task.task.target).toBe('worker');
    const stopped = await roomAction({ action: 'stop', room: 'r', callsign: 'boss', text: 'done' }, context(), services) as any;
    expect(stopped.event.kind).toBe('task-stop');
    const who = await roomAction({ action: 'who', room: 'r' }, context(), services) as any;
    expect(who.tasks[0]).toMatchObject({ spec: 'build it', target: 'worker', status: 'open' });
  });

  it('runs one bounded dry-run auto turn through the physical loop', async () => {
    isolatedHome();
    const services = service();
    await roomAction({ action: 'join', room: 'r', callsign: 'human' }, context(), services);
    await roomAction({ action: 'post', room: 'r', callsign: 'human', text: '@bot hello' }, context(), services);
    const result = await roomAction({ action: 'auto', room: 'r', callsign: 'bot', 'dry-run': true, 'max-turns': '1' }, context(), services) as any;
    expect(result.turns).toBe(1);
    expect(result.posted[0].body).toContain('(dry-run) bot acks');
  });

  it('runs the work loop, completes a task once, and respects cancellation', async () => {
    isolatedHome();
    const services = service();
    await roomAction({ action: 'join', room: 'r', callsign: 'boss' }, context(), services);
    await roomAction({ action: 'task', room: 'r', callsign: 'boss', text: 'build it', for: 'worker' }, context(), services);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const result = await roomAction({ action: 'work', room: 'r', callsign: 'worker', 'dry-run': true, 'poll-ms': '50' }, context(controller.signal), services) as any;
    expect(result.tasksHandled).toBe(1);
    expect(result.completed[0]).toMatchObject({ kind: 'result', body: expect.stringContaining('completed') });
    expect(result.stopped).toBe('aborted');
  });

  it('denies mutation without permission', async () => {
    isolatedHome();
    await expect(roomAction({ action: 'create', room: 'x' }, context(), service('deny'))).rejects.toThrow('Permission denied');
  });
});
