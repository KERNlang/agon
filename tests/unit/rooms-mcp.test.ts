import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { ROOM_TOOLS, isRoomTool, handleRoomTool } from '../../packages/mcp/src/generated/rooms.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-rooms-mcp-'));
  process.env.AGON_HOME = home;
});
afterEach(() => {
  delete process.env.AGON_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('rooms MCP tools', () => {
  it('exposes the room tool set and classifies tool names', () => {
    expect(ROOM_TOOLS.map((t) => t.name)).toEqual(['RoomJoin', 'RoomPost', 'RoomRead', 'RoomWho', 'RoomLock', 'RoomRelease', 'RoomLeave', 'RoomList']);
    expect(isRoomTool('RoomPost')).toBe(true);
    expect(isRoomTool('RoomLock')).toBe(true);
    expect(isRoomTool('Forge')).toBe(false);
  });

  it('supports unreadOnly + markRead read cursors per member', () => {
    handleRoomTool('RoomJoin', { room: 'sync', callsign: 'codex' });
    handleRoomTool('RoomPost', { room: 'sync', callsign: 'codex', text: 'one' });
    handleRoomTool('RoomPost', { room: 'sync', callsign: 'codex', text: 'two @claude' });

    const first = JSON.parse(handleRoomTool('RoomRead', { room: 'sync', callsign: 'claude', unreadOnly: true, markRead: true }));
    expect(first.events.map((e: any) => e.body)).toContain('two @claude');
    expect(first.unread.unreadCount).toBe(0);   // cursor advanced in the same call

    const second = JSON.parse(handleRoomTool('RoomRead', { room: 'sync', callsign: 'claude', unreadOnly: true, markRead: true }));
    expect(second.events).toHaveLength(0);      // nothing unread on the next turn

    expect(handleRoomTool('RoomRead', { room: 'sync', unreadOnly: true })).toMatch(/Error: .*callsign/);
  });

  it('locks resources with TTL, refuses contention, and releases', () => {
    handleRoomTool('RoomJoin', { room: 'build', callsign: 'a' });
    const locked = JSON.parse(handleRoomTool('RoomLock', { room: 'build', callsign: 'a', resource: 'core.ts' }));
    expect(locked.locked).toBe('core.ts');
    expect(locked.stolen).toBe(false);

    expect(handleRoomTool('RoomLock', { room: 'build', callsign: 'b', resource: 'core.ts' })).toMatch(/Error: .*held by a/);
    expect(handleRoomTool('RoomLock', { room: 'build', callsign: 'b', resource: 'core.ts', steal: true })).toMatch(/Error: .*ACTIVE/);

    const who = JSON.parse(handleRoomTool('RoomWho', { room: 'build' }));
    expect(who.locks).toHaveLength(1);
    expect(who.locks[0]).toMatchObject({ resource: 'core.ts', holder: 'a', status: 'active' });

    expect(handleRoomTool('RoomRelease', { room: 'build', callsign: 'b', resource: 'core.ts' })).toMatch(/^Error:/);
    const released = JSON.parse(handleRoomTool('RoomRelease', { room: 'build', callsign: 'a', resource: 'core.ts' }));
    expect(released.released).toBe('core.ts');
  });

  it('drives a full join → post → read flow over the ledger', () => {
    const joined = JSON.parse(handleRoomTool('RoomJoin', { room: 'Design', callsign: 'codex', engine: 'codex' }));
    expect(joined.joined).toBe('design');
    expect(joined.as).toBe('codex');

    const posted = JSON.parse(handleRoomTool('RoomPost', { room: 'design', callsign: 'codex', text: 'file-first @claude' }));
    expect(posted.seq).toBeGreaterThan(0);
    expect(posted.mentions).toEqual(['claude']);

    const read = JSON.parse(handleRoomTool('RoomRead', { room: 'design', since: 0 }));
    expect(read.events.map((e: any) => e.body)).toContain('file-first @claude');

    const list = JSON.parse(handleRoomTool('RoomList', {}));
    expect(list.map((r: any) => r.roomId)).toContain('design');
  });

  it('returns Error strings (never throws) for bad input', () => {
    expect(handleRoomTool('RoomPost', { room: 'ghost', callsign: 'x', text: 'hi' })).toMatch(/^Error:/);
    expect(handleRoomTool('RoomRead', { room: 'nope' })).toMatch(/^Error:/);
    expect(handleRoomTool('RoomJoin', { callsign: 'x' })).toMatch(/Error: "room" is required/);
    expect(handleRoomTool('RoomPost', { room: 'design', callsign: 'codex' })).toMatch(/Error: .*text/);
  });
});
