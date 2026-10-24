import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from '@kernlang/agon-mod-api';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';
import { createTeamBrainstormHostServices, runTeamBrainstormSession } from '@kernlang/agon-mod-team-brainstorm';
import {
  captureProcessSurfaceAuthority, disposeProcessSurfaceAuthority,
  executeProcessCesarRoute, initializeProcessSurfaceAuthority,
} from '../../packages/cli/src/surface-authority-runtime.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

let home: string;
afterEach(async () => {
  try { await disposeProcessSurfaceAuthority(); }
  finally { cleanupTestAgonHome(home); }
});

it.each(['success', 'receipt-failure', 'cancelled'] as const)
  ('settles the real generation-selected Team Brainstorm session: %s', async mode => {
    home = setupTestAgonHome('team-session-authority');
    const path = join(home, 'canonical-match');
    const controller = new AbortController();
    const dispatchEngine = vi.fn(async (_id: string, prompt: string) => {
      if (mode === 'cancelled') controller.abort(new Error('fixture cancelled'));
      return { exitCode: 0, stdout: prompt.includes('BRAINSTORM JUDGE')
        ? 'SCORE_ALPHA: 60\nSCORE_BETA: 80\nWINNER: BETA' : 'fixture proposal',
      stderr: '', timedOut: false, durationMs: 1 };
    });
    const registry = {
      get: (id: string) => ({ id, schemaVersion: 3, displayName: id, binary: process.execPath } as EngineDefinition),
      isAvailable: () => true,
    };
    const teamBrainstorm = createTeamBrainstormHostServices({
      openRegistry: () => registry,
      createAdapter: () => ({ dispatch: options => dispatchEngine(options.engine.id, options.prompt) } as EngineAdapter),
      captureAuthority: captureProcessSurfaceAuthority,
      loadConfig: () => ({ cesarEngine: 'b', ratingsEnabled: false }),
      partitionRoster: (_registry, requested) => ({ active: requested ?? ['a', 'b'], removed: [] }),
      classifyTask: () => 'other', loadConfidenceFloor: () => undefined,
      readRatings: () => ({ global: {}, byMode: { brainstorm: {} } }),
      updateTeamElo: vi.fn(), buildKernDraftPrompt, parseKernDraft,
    });
    const finish = vi.fn();
    const record = vi.fn(async () => {
      if (mode === 'receipt-failure') throw new Error('fixture receipt unavailable');
      return 'receipt';
    });
    await initializeProcessSurfaceAuthority(join(home, 'host'), (manifest, base) => manifest.id !== 'agon.team-brainstorm'
      ? base : { ...base, teamBrainstorm, receipts: { record }, runs: {
        start: async () => {
          await mkdir(path);
          return { id: 'match', mode: 'team-brainstorm', path, startedAt: new Date().toISOString() };
        },
        finish, writeArtifact: async (_run, name, content) => { await writeFile(join(path, name), content); },
      } });
    const display = vi.fn();
    const appendMessage = vi.fn();
    const setActiveAbort = vi.fn();
    const run = runTeamBrainstormSession('Question', 1, controller, {
      ensureHome: () => {}, engines: () => ({ active: ['a', 'b'], excluded: [] }),
      project: () => ({ cwd: home, context: '', judge: 'b' }),
      dispatch: display, setActiveAbort, appendMessage,
    }, async (input, context) => await executeProcessCesarRoute('team-brainstorm', input, context) as CommandResult);
    if (mode === 'cancelled') {
      await expect(run).rejects.toThrow('fixture cancelled');
      expect(appendMessage).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(display.mock.calls.some(([event]) => event.type === 'verdict')).toBe(false);
    } else {
      if (mode === 'receipt-failure') await expect(run).rejects.toThrow('fixture receipt unavailable');
      else await expect(run).resolves.toBe(true);
      expect(dispatchEngine).toHaveBeenCalledTimes(5);
      expect(display).toHaveBeenCalledWith({ type: 'info', message: `Full results saved: ${path}` });
      expect(display).toHaveBeenCalledWith({ type: 'verdict', summary: 'fixture proposal' });
      expect(appendMessage).toHaveBeenCalledTimes(2);
      expect(appendMessage.mock.calls[1][0].content).toContain('Winner: Team Beta');
      if (mode === 'receipt-failure') expect(appendMessage.mock.calls[1][0].content).toContain('fixture receipt unavailable');
      expect(finish).toHaveBeenCalledTimes(1);
      expect(finish.mock.calls[0][1]).toMatchObject({ ok: true });
      const saved = JSON.parse(await readFile(join(path, 'team-result.json'), 'utf8'));
      expect(saved.winnerTeamId).toBe(saved.teams[1].teamId);
      expect(record).toHaveBeenCalledOnce();
    }
    expect(display).toHaveBeenLastCalledWith({ type: 'spinner-stop' });
    expect(setActiveAbort).toHaveBeenLastCalledWith(null);
  });
