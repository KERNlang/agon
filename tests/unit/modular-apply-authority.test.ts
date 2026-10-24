import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import { patchApplicationHost, withPatchApplication } from '../../packages/cli/src/patch-application-host.js';
import { dispatchSessionInfoIntent } from '../../packages/cli/src/signals/dispatch/intent-session.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';
import type { ModServices } from '@kernlang/agon-mod-api';
import { runApply } from '../../packages/mod-forge/src/apply.js';

const workspace = vi.hoisted(() => ({ cwd: '' }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(), resolveWorkingDir: () => workspace.cwd,
}));

const NOW = '2026-10-09T00:00:00.000Z';
const context = { invocationId: 'apply-authority', cwd: '/fixture', platform: 'darwin-arm64' as const,
  signal: new AbortController().signal, config: {} };

describe.each([true, false])('Apply host authority with disabled=%s', disabled => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agon-apply-authority-'));
    workspace.cwd = join(root, 'workspace');
    execFileSync('git', ['init', '--quiet', workspace.cwd]);
    await writeFile(join(workspace.cwd, 'file.txt'), 'before\n');
    execFileSync('git', ['add', 'file.txt'], { cwd: workspace.cwd });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
      'commit', '--quiet', '-m', 'fixture'], { cwd: workspace.cwd });
    const catalog = createFirstPartyModCatalog();
    const full = createFullCompatDesiredState(catalog, NOW);
    const desired = disabled ? planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.forge' }, NOW).nextState : full;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'apply-authority-test' });
    await host.commitGeneration({ operation: disabled ? 'disable' : 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
    await initializeProcessSurfaceAuthority(root);
  });
  afterEach(async () => {
    await disposeProcessSurfaceAuthority();
    for (const generation of await readdir(join(root, 'generations'))) await chmod(join(root, 'generations', generation), 0o755);
    await rm(root, { recursive: true, force: true });
  });

  it('checks the selected owner before exposing approval capabilities', async () => {
    const ui = { artifacts: [], notify: vi.fn(), preview: vi.fn(), confirm: vi.fn(async () => 'yes') };
    await withPatchApplication(context.invocationId, ui, async () => {
      if (disabled) expect(() => patchApplicationHost.open(context)).toThrow('unavailable');
      else {
        const interaction = (await patchApplicationHost.open(context))!;
        expect(await interaction.confirm(context.cwd)).toBe('yes');
      }
    });
    expect(ui.confirm).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });

  it('rejects stale generation selection before opening an interaction', async () => {
    const pointer = join(root, 'current-generation.json');
    const original = await readFile(pointer);
    try {
      await writeFile(pointer, '{}\n');
      await withPatchApplication(context.invocationId,
        { artifacts: [], notify: vi.fn(), preview: vi.fn(), confirm: vi.fn(async () => 'yes') }, async () => {
          expect(() => patchApplicationHost.open(context)).toThrow('restart Agon');
        });
    } finally { await writeFile(pointer, original); }
  });

  it('does not permit the legacy-shaped dispatch path to bypass the selected owner', async () => {
    const askQuestion = vi.fn(async () => 'yes');
    let job: Promise<void> | undefined;
    const runAsJob = vi.fn((_kind: string, _label: string, run: (signal: AbortSignal) => Promise<void>) => {
      job = run(new AbortController().signal);
    });
    const cb = { dispatch: vi.fn(), runAsJob, ctx: { config: {}, askQuestion } } as unknown as DispatchCallbacks;
    if (disabled) {
      expect(await dispatchSessionInfoIntent({ type: 'apply' }, '/apply', cb)).toEqual({ handled: true, ranAsJob: false });
      expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('unavailable') }));
      expect(runAsJob).not.toHaveBeenCalled();
    } else {
      // With no selected artifact, the real physical workflow returns a
      // preflight error. It must not ask for approval or execute a competition.
      expect(await dispatchSessionInfoIntent({ type: 'apply' }, '/apply', cb)).toEqual({ handled: true, ranAsJob: true });
      await job;
      expect(cb.dispatch).toHaveBeenCalledWith({ type: 'error', message: 'No patch found. Run /forge first or provide a path.' });
    }
    expect(askQuestion).not.toHaveBeenCalled();
  });

  if (!disabled) it('rejects an affirmative answer when the generation changed during the prompt', async () => {
    const pointer = join(root, 'current-generation.json');
    const original = await readFile(pointer);
    try {
      await withPatchApplication(context.invocationId, { artifacts: [], notify: vi.fn(), preview: vi.fn(),
        confirm: async () => { await writeFile(pointer, '{}\n'); return 'yes'; } }, async () => {
        const interaction = (await patchApplicationHost.open(context))!;
        await expect(interaction.confirm(context.cwd)).rejects.toThrow('restart Agon');
      });
    } finally { await writeFile(pointer, original); }
  });

  if (!disabled) it('does not write after a valid new generation disables Forge during approval', async () => {
    const patch = join(root, 'change.patch');
    await writeFile(patch, 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n');
    const invocation = { ...context, cwd: workspace.cwd };
    const ui = { artifacts: [], notify: vi.fn(), preview: vi.fn(), confirm: async () => {
      const catalog = createFirstPartyModCatalog();
      const desired = planDesiredStateChange(catalog, createFullCompatDesiredState(catalog, NOW),
        { kind: 'disable', id: 'agon.forge' }, NOW).nextState;
      const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'apply-disable-test' });
      await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
      return 'yes';
    } };
    await withPatchApplication(invocation.invocationId, ui, async () => {
      await expect(runApply({ patchPath: patch }, invocation,
        { patchApplication: patchApplicationHost } as ModServices)).rejects.toThrow('restart Agon');
    });
    expect(await readFile(join(workspace.cwd, 'file.txt'), 'utf8')).toBe('before\n');
  });
});
