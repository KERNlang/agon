import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { cliRunRecordHost as runs } from '../../packages/cli/src/run-record-host.js';
import { createRunDir } from '@kernlang/agon-support-persistence';
import { spawnSync } from 'node:child_process';
import type { InvocationContext, Json, ModServices, RunRecordHandle } from '../../packages/mod-api/src/index.js';
import { runForgeCompetition as runCompetition } from '../../packages/mod-forge/src/implementation.js';
import { withForgeHost } from '../helpers/forge-host.js';
import { registerExitHooks } from '../../packages/core/src/blocks/git.js';

const runForgeCompetition = (raw: Json, context: InvocationContext, services: ModServices) =>
  runCompetition(raw, context, withForgeHost(services));

async function isolated(check: (exit: () => void) => Promise<void>) {
  // The Git host owns permanent hooks. Count run-scoped listeners separately.
  registerExitHooks();
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

it.each(['start', 'candidate', 'artifact', 'receipt', 'finish', 'invalid-repository', 'success',
  'artifact-error', 'receipt-error', 'cleanup-error', 'failed-finish', 'harvested-finish', 'dry-finish',
  'blocked-finish', 'blocked-cancel', 'cleanup-after-finish'] as const)(
  'finalizes physical Forge before host exit: %s', async phase => {
    await isolated(async exit => {
      const root = mkdtempSync(join(tmpdir(), 'agon-forge-status-'));
      const controller = new AbortController();
      const reason = new Error('cancel Forge status fixture');
      const before = process.listenerCount('exit');
      let handle: RunRecordHandle | undefined;
      const submitted: Json[] = [];
      const cleanups: string[][] = [];
      const blocked = phase === 'blocked-finish' || phase === 'blocked-cancel';
      const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
      const context: InvocationContext = { invocationId: 'forge-status', cwd: root,
        platform: 'darwin-arm64', signal: controller.signal, config: {} };
      try {
        if (phase !== 'invalid-repository') {
          for (const args of [['init', '--quiet'], ['-c', 'user.name=Fixture', '-c',
            'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']]) {
            const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
            expect(result.status, result.stderr).toBe(0);
          }
        }
        const services = {
          engines: { listActive: async () => ['fixture'], dispatch: async (_engine: string, _prompt: string, invocation: InvocationContext) => {
            if (phase !== 'failed-finish') writeFileSync(join(invocation.cwd, 'result.txt'), 'candidate\n');
            if (phase === 'candidate' || phase === 'blocked-cancel') controller.abort(reason);
            return { exitCode: phase === 'failed-finish' || phase === 'harvested-finish' ? 1 : 0, stdout: 'implemented', stderr: '' };
          } },
          logger: { debug: async (_message: string, fields: { worktreePaths: string[] }) => {
            expect(fields.worktreePaths.every(path => !existsSync(path))).toBe(true);
            cleanups.push(fields.worktreePaths);
            if (phase === 'cleanup-error' || phase === 'cleanup-after-finish') throw reason;
          } },
          receipts: { record: async () => {
            if (phase === 'receipt-error') throw reason;
            if (phase === 'receipt') controller.abort(reason);
            return 'fixture';
          } },
          runs: {
            start: async (...args: Parameters<typeof runs.start>) => {
              handle = await runs.start(...args);
              if (phase === 'start') controller.abort(reason);
              return handle;
            },
            writeArtifact: async (...args: Parameters<typeof runs.writeArtifact>) => {
              await runs.writeArtifact(...args);
              if (phase === 'artifact') controller.abort(reason);
              if (phase === 'artifact-error' || phase === 'cleanup-error') throw reason;
            },
            finish: async (...args: Parameters<typeof runs.finish>) => {
              submitted.push(structuredClone(args[1]));
              if (['candidate', 'artifact', 'receipt', 'artifact-error', 'receipt-error', 'cleanup-error', 'blocked-cancel'].includes(phase)) {
                expect(cleanups).toHaveLength(1);
              }
              if (blocked) mkdirSync(join(args[0].path, '.status.json.tmp'));
              await runs.finish(...args);
              if (['finish', 'failed-finish', 'harvested-finish', 'dry-finish', 'blocked-finish'].includes(phase)) controller.abort(reason);
            },
          },
        } as unknown as ModServices;
        const outcome = await runForgeCompetition({ task: 'fixture', noHealthCheck: true, test: 'true', dryRun: phase === 'dry-finish' }, context, services)
          .then(result => ({ result, error: undefined }), error => ({ result: undefined, error }));
        if (phase === 'success') expect(outcome.result?.exitCode).toBe(0);
        else if (phase === 'invalid-repository') expect(outcome.result?.failure?.code).toBe('NOT_A_GIT_REPOSITORY');
        else expect(outcome.error).toBe(reason);
        expect(handle).toBeDefined();
        expect(submitted).toHaveLength(1);
        const path = join(handle!.path, 'status.json');
        if (blocked) {
          expect(existsSync(path)).toBe(false);
          expect(warning).toHaveBeenCalledWith(expect.stringContaining('failed to write status.json'));
          expect(process.listenerCount('exit')).toBe(before + 1);
          rmSync(join(handle!.path, '.status.json.tmp'), { recursive: true });
          exit();
        }
        expect(existsSync(path)).toBe(true);
        const bytes = readFileSync(path, 'utf8');
        const status = JSON.parse(bytes);
        expect(status).toEqual(submitted[0]);
        expect(status).toMatchObject({ mode: 'forge', ok: ['success', 'finish', 'harvested-finish', 'dry-finish', 'blocked-finish', 'cleanup-after-finish'].includes(phase) });
        if (phase === 'harvested-finish') {
          expect(status.summary).toContain('winner=fixture');
          expect(status.engines).toMatchObject([{ id: 'fixture', status: 'ok' }]);
          expect(readFileSync(join(handle!.path, 'fixture-patch.diff'), 'utf8')).toContain('candidate');
          const manifest = JSON.parse(readFileSync(join(handle!.path, 'manifest.json'), 'utf8'));
          expect(manifest.results.fixture.dispatchStdout).toContain('dispatch exited with code 1');
          const result = JSON.parse(readFileSync(join(handle!.path, 'competition.json'), 'utf8'));
          expect(result).toMatchObject({ baseSha: expect.stringMatching(/^[a-f0-9]{40}$/),
            candidates: [{ engineId: 'fixture', pass: true, dispatchOk: false }] });
        }
        if (phase === 'failed-finish') {
          expect(status.summary).toContain('no winner');
          expect(status.engines).toMatchObject([{ id: 'fixture', status: 'error' }]);
        }
        if (['artifact-error', 'receipt-error', 'cleanup-error'].includes(phase)) {
          expect(status).toMatchObject({ summary: reason.message, engines: [] });
        }
        expect(process.listenerCount('exit')).toBe(before);
        if (phase === 'artifact' || phase === 'artifact-error') expect(existsSync(join(handle!.path, 'manifest.json'))).toBe(true);
        exit();
        expect(readFileSync(path, 'utf8')).toBe(bytes);
      } finally { warning.mockRestore(); rmSync(root, { recursive: true, force: true }); }
    });
  },
);

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

it.each([true, false])('retains the actual final outcome after a failed status write (ok=%s)', async ok => {
  await isolated(async exit => {
    const handle = await runs.start('brainstorm', 'write-failure', {} as never);
    const obstruction = join(handle.path, '.status.json.tmp');
    mkdirSync(obstruction);
    const status = { ok, summary: 'actual engine outcome', engines: [{ id: 'fixture', status: ok ? 'ok' : 'error' }] };
    const expected = JSON.parse(JSON.stringify(status));
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runs.finish(handle, status, {} as never);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('failed to write status.json'));
      expect(existsSync(join(handle.path, 'status.json'))).toBe(false);
      // Recovery must not retain a mutable reference to a caller's result.
      status.summary = 'mutated later';
      status.engines[0]!.id = 'changed';
      rmSync(obstruction, { recursive: true });
      exit();
      expect(existsSync(join(handle.path, 'status.json'))).toBe(true);
      expect(JSON.parse(readFileSync(join(handle.path, 'status.json'), 'utf8'))).toEqual(expected);
    } finally { warning.mockRestore(); }
  });
});

it('bounds exit retries and still finalizes other runs when storage remains unavailable', async () => {
  await isolated(async exit => {
    const before = process.listenerCount('exit');
    const blocked = await runs.start('brainstorm', undefined, {} as never);
    const other = await runs.start('review', undefined, {} as never);
    mkdirSync(join(blocked.path, '.status.json.tmp'));
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runs.finish(blocked, { ok: true, summary: 'real result' }, {} as never);
      exit();
      expect(warning).toHaveBeenCalledTimes(2); // Initial write and one exit retry.
      expect(existsSync(join(blocked.path, 'status.json'))).toBe(false);
      expect(JSON.parse(readFileSync(join(other.path, 'status.json'), 'utf8')).ok).toBe(false);
      expect(process.listenerCount('exit')).toBe(before);
      exit();
      expect(warning).toHaveBeenCalledTimes(2);
    } finally { warning.mockRestore(); }
  });
});

it('releases tracking after an explicit successful persistence retry', async () => {
  await isolated(async exit => {
    const before = process.listenerCount('exit');
    const handle = await runs.start('review', undefined, {} as never);
    const obstruction = join(handle.path, '.status.json.tmp');
    mkdirSync(obstruction);
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const status = { ok: false, summary: 'actual failure' };
      await runs.finish(handle, status, {} as never);
      expect(process.listenerCount('exit')).toBe(before + 1);
      rmSync(obstruction, { recursive: true });
      await runs.finish(handle, status, {} as never);
      expect(process.listenerCount('exit')).toBe(before);
      const bytes = readFileSync(join(handle.path, 'status.json'), 'utf8');
      exit();
      expect(readFileSync(join(handle.path, 'status.json'), 'utf8')).toBe(bytes);
    } finally { warning.mockRestore(); }
  });
});
