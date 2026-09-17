import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { cliRunRecordHost as runs } from '../../packages/cli/src/run-record-host.js';
import { createRunDir } from '@kernlang/agon-support-persistence';

async function isolated(check: (exit: () => void) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'agon-run-exit-'));
  const previous = process.env.AGON_HOME;
  const before = new Set(process.listeners('exit'));
  const exit = () => {
    const added = process.listeners('exit').filter(listener => !before.has(listener));
    expect(added.length).toBeLessThanOrEqual(1);
    for (const listener of added) listener(0);
  };
  process.env.AGON_HOME = home;
  try { await check(exit); }
  finally {
    exit();
    process.env.AGON_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
}

it('persists an unsuccessful interrupted record without inventing engine outcomes or touching foreign runs', async () => {
  await isolated(async exit => {
    const foreign = createRunDir({ mode: 'foreign', announce: false });
    const handle = await runs.start('brainstorm', 'exit-fixture', {} as never);
    await runs.writeArtifact(handle, 'partial.txt', 'retained draft', {} as never);
    exit();
    const status = JSON.parse(readFileSync(join(handle.path, 'status.json'), 'utf8'));
    expect(status).toMatchObject({ mode: 'brainstorm', label: 'exit-fixture', startedAt: handle.startedAt, ok: false, engines: [] });
    expect(status.summary).toMatch(/host exited before finalization/);
    expect(status.summary).toMatch(/not automatically resumed/);
    expect(readFileSync(join(handle.path, 'partial.txt'), 'utf8')).toBe('retained draft');
    expect(existsSync(join(foreign.path, 'status.json'))).toBe(false);
  });
});

it('preserves completed and already-persisted outcomes byte-for-byte', async () => {
  await isolated(async exit => {
    const completed = await runs.start('brainstorm', undefined, {} as never);
    await runs.finish(completed, { ok: true, summary: 'real result' }, {} as never);
    const bytes = readFileSync(join(completed.path, 'status.json'), 'utf8');
    const persisted = await runs.start('review', undefined, {} as never);
    writeFileSync(join(persisted.path, 'status.json'), '{"ok":false,"summary":"real failure"}\n');
    exit();
    expect(readFileSync(join(completed.path, 'status.json'), 'utf8')).toBe(bytes);
    expect(readFileSync(join(persisted.path, 'status.json'), 'utf8')).toBe('{"ok":false,"summary":"real failure"}\n');
  });
});

it('shares one exit handler and removes it after all runs finish', async () => {
  await isolated(async () => {
    const before = process.listenerCount('exit');
    const handles = await Promise.all(Array.from({ length: 12 }, () => runs.start('brainstorm', undefined, {} as never)));
    expect(process.listenerCount('exit')).toBe(before + 1);
    for (const handle of handles) await runs.finish(handle, { ok: false, summary: 'finished' }, {} as never);
    expect(process.listenerCount('exit')).toBe(before);
  });
});

it('retains run artifact traversal rejection', async () => {
  await isolated(async () => {
    const handle = await runs.start('brainstorm', undefined, {} as never);
    expect(() => runs.writeArtifact(handle, '../outside', 'bad', {} as never)).toThrow(/escapes/);
  });
});

it('records an immutable host incarnation before returning a run handle', async () => {
  await isolated(async () => {
    const first = await runs.start('brainstorm', undefined, {} as never);
    const second = await runs.start('review', undefined, {} as never);
    expect(existsSync(join(first.path, 'owner.json'))).toBe(true);
    const owner = JSON.parse(readFileSync(join(first.path, 'owner.json'), 'utf8'));
    const other = JSON.parse(readFileSync(join(second.path, 'owner.json'), 'utf8'));
    expect(owner).toMatchObject({ schemaVersion: 1, runId: first.id, pid: process.pid });
    expect(owner.hostInstance).toMatch(/^[0-9a-f-]{36}$/i);
    expect(other.hostInstance).toBe(owner.hostInstance);
    expect(other.runId).not.toBe(owner.runId);
    const bytes = readFileSync(join(first.path, 'owner.json'), 'utf8');
    await runs.finish(first, { ok: true, summary: 'finished' }, {} as never);
    expect(readFileSync(join(first.path, 'owner.json'), 'utf8')).toBe(bytes);
  });
});
