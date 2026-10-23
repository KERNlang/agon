import { expect, it, vi } from 'vitest';
import type { ModManifest, ModServices } from '@kernlang/agon-mod-api';
import type { BrainstormModServices } from '@kernlang/agon-mod-brainstorm';
import type { ConquerModServices } from '@kernlang/agon-mod-conquer';
import type { GoalModServices } from '@kernlang/agon-mod-goal';
import * as core from '@kernlang/agon-core';
import * as worktree from '@kernlang/agon-support-worktree';
import * as authority from '../../packages/cli/src/surface-authority-runtime.js';
import { decorateCliFirstPartyServices } from '../../packages/cli/src/first-party-services.js';

it('loads Goal host code only when decorating the Goal owner', async () => {
  vi.doMock('@kernlang/agon-mod-goal', () => { throw new Error('fixture Goal package unavailable'); });
  vi.resetModules();
  try {
    const host = await import('../../packages/cli/src/first-party-services.js');
    const unrelated = await host.decorateCliFirstPartyServices({ id: 'agon.ask' } as ModManifest, {} as ModServices);
    expect(unrelated.engines.dispatch).toBeTypeOf('function');
    await expect(host.decorateCliFirstPartyServices({ id: 'agon.goal' } as ModManifest, {} as ModServices))
      .rejects.toMatchObject({ cause: { message: 'fixture Goal package unavailable' } });
  } finally {
    vi.doUnmock('@kernlang/agon-mod-goal');
    vi.resetModules();
  }
});

it('reads the Plan session host only when decorating the Plan owner', async () => {
  vi.doMock('@kernlang/agon-mod-plan', async importOriginal => ({
    ...await importOriginal<typeof import('@kernlang/agon-mod-plan')>(),
    get planSessionHost() { throw new Error('fixture Plan session host unavailable'); },
  }));
  vi.resetModules();
  try {
    const host = await import('../../packages/cli/src/first-party-services.js');
    const unrelated = await host.decorateCliFirstPartyServices({ id: 'agon.ask' } as ModManifest, {} as ModServices);
    expect(unrelated.engines.dispatch).toBeTypeOf('function');
    await expect(host.decorateCliFirstPartyServices({ id: 'agon.plan' } as ModManifest, {} as ModServices))
      .rejects.toThrow('fixture Plan session host unavailable');
  } finally {
    vi.doUnmock('@kernlang/agon-mod-plan');
    vi.resetModules();
  }
});

it.each([
  { forgeJudgeEngine: 'forge-judge', cesarEngine: 'cesar', expected: 'forge-judge' },
  { forgeJudgeEngine: '', cesarEngine: 'cesar', expected: 'cesar' },
  { forgeJudgeEngine: '', cesarEngine: '', expected: undefined },
])('projects Goal review defaults from target configuration (judge=$expected)', async ({ forgeJudgeEngine, cesarEngine, expected }) => {
  const load = vi.spyOn(core, 'loadConfig').mockReturnValue({
    goalReviewEngines: ['configured-reviewer'], forgeJudgeEngine, cesarEngine,
  } as ReturnType<typeof core.loadConfig>);
  vi.spyOn(core.EngineRegistry.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(core.EngineRegistry.prototype, 'listIds').mockReturnValue(['remote', 'local']);
  vi.spyOn(core.EngineRegistry.prototype, 'get').mockImplementation(id => ({ id, isLocal: id === 'local' }) as ReturnType<core.EngineRegistry['get']>);
  vi.spyOn(authority, 'captureProcessSurfaceAuthority').mockReturnValue(() => {});
  try {
    const services = await decorateCliFirstPartyServices({ id: 'agon.goal' } as ModManifest, {} as ModServices) as GoalModServices;
    expect(load).not.toHaveBeenCalled();
    const opened = services.goal!.open({ invocationId: 'goal-defaults', cwd: '/fixture-target',
      platform: 'darwin-arm64', signal: new AbortController().signal,
      config: { goalReviewEngines: ['wrong-owner-decoy'], forgeJudgeEngine: 'wrong-judge' } });
    expect(opened.reviewDefaults!()).toEqual({ configuredEngines: ['configured-reviewer'], localEngines: ['local'], judge: expected });
    expect(load).toHaveBeenCalledExactlyOnceWith('/fixture-target');
  } finally { vi.restoreAllMocks(); }
});


it('binds Conquer publication to kernel configuration rather than mod-owned configuration', async () => {
  const config = { protectedPushBranches: ['kernel-protected'], commitCoAuthor: '' } as ReturnType<typeof core.loadConfig>;
  const load = vi.spyOn(core, 'loadConfig').mockReturnValue(config);
  const format = vi.spyOn(worktree, 'appendAttribution').mockReturnValue('kernel-formatted');
  vi.spyOn(core.EngineRegistry.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(authority, 'captureProcessSurfaceAuthority').mockReturnValue(() => {});
  vi.spyOn(authority, 'assertProcessSurfaceAvailable').mockImplementation(() => {});
  try {
    const services = await decorateCliFirstPartyServices({ id: 'agon.conquer' } as ModManifest, {} as ModServices) as ConquerModServices;
    const opened = await services.conquer!.open({ invocationId: 'policy-host', cwd: '/fixture-project',
      platform: 'darwin-arm64', signal: new AbortController().signal,
      config: { protectedPushBranches: ['mod-owned-decoy'], commitCoAuthor: 'decoy' } });
    expect(load).toHaveBeenCalledExactlyOnceWith('/fixture-project');
    expect(opened.publication!.protectedPushBranches).toEqual(['kernel-protected']);
    expect(opened.publication!.commitBody('verified claim')).toBe('kernel-formatted');
    expect(format).toHaveBeenCalledExactlyOnceWith('verified claim', config);
  } finally { vi.restoreAllMocks(); }
});

it.each((['conquer', 'goal'] as const).flatMap(owner =>
  (['enabled', 'disabled', 'retired-during'] as const).map(state => ({ owner, state }))))('guards optional Forge PR prose for $owner when $state', async ({ owner, state }) => {
  let current = true;
  vi.spyOn(core, 'loadConfig').mockReturnValue({ protectedPushBranches: [] } as ReturnType<typeof core.loadConfig>);
  vi.spyOn(core.EngineRegistry.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(authority, 'captureProcessSurfaceAuthority').mockReturnValue(() => {
    if (!current) throw new Error('fixture generation retired');
  });
  vi.spyOn(authority, 'assertProcessSurfaceAvailable').mockImplementation((_surface, id) => {
    if (id === 'forge' && state === 'disabled') throw new Error('fixture Forge disabled');
  });
  const dispatch = vi.fn(async () => {
    if (state === 'retired-during') current = false;
    return 'TITLE: feat: fixture\n\nVerified fixture body';
  });
  try {
    const services = await decorateCliFirstPartyServices({ id: `agon.${owner}` } as ModManifest, {} as ModServices) as ConquerModServices & GoalModServices;
    const opened = await services[owner]!.open({ invocationId: 'draft-host', cwd: '/fixture-project',
      platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
    const draft = opened.draftPullRequest!({ engineId: 'fixture', intent: 'task', context: 'verified', commits: '', diff: '' }, dispatch);
    if (state === 'enabled') {
      await expect(draft).resolves.toMatchObject({ ok: true, title: 'feat: fixture', body: 'Verified fixture body' });
      expect(dispatch).toHaveBeenCalledTimes(1);
    } else {
      await expect(draft).rejects.toThrow(state === 'disabled' ? 'fixture Forge disabled' : 'fixture generation retired');
      expect(dispatch).toHaveBeenCalledTimes(state === 'disabled' ? 0 : 1);
    }
  } finally { vi.restoreAllMocks(); }
});

it('provides the terminal writer only to the CLI Brainstorm host and writes nothing during decoration', async () => {
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  try {
    const services = await decorateCliFirstPartyServices({ id: 'agon.brainstorm' } as ModManifest, {} as ModServices) as BrainstormModServices;
    expect(write).not.toHaveBeenCalled();
    expect(services.brainstorm?.writeCliOutput).toBeTypeOf('function');
    services.brainstorm!.writeCliOutput!('fixture stream\n');
    expect(write).toHaveBeenCalledExactlyOnceWith('fixture stream\n');
    const pipeline = await decorateCliFirstPartyServices({ id: 'agon.pipeline-orchestration' } as ModManifest, {} as ModServices) as BrainstormModServices;
    expect(pipeline.brainstorm?.writeCliOutput).toBeUndefined();
    const conquer = await decorateCliFirstPartyServices({ id: 'agon.conquer' } as ModManifest, {} as ModServices) as BrainstormModServices;
    expect(conquer.brainstorm?.open).toBeTypeOf('function');
    expect(conquer.brainstorm?.writeCliOutput).toBeUndefined();
    const unrelated = await decorateCliFirstPartyServices({ id: 'agon.ask' } as ModManifest, {} as ModServices) as BrainstormModServices;
    expect(unrelated.brainstorm).toBeUndefined();
  } finally { write.mockRestore(); }
});
