import { expect, it, vi } from 'vitest';
import type { ModManifest, ModServices } from '@kernlang/agon-mod-api';
import type { BrainstormModServices } from '@kernlang/agon-mod-brainstorm';
import type { ConquerModServices } from '@kernlang/agon-mod-conquer';
import * as core from '@kernlang/agon-core';
import * as forge from '@kernlang/agon-forge';
import * as adapters from '@kernlang/agon-adapter-cli';
import { conquerCommand } from '../../packages/cli/src/commands/conquer.js';
import * as authority from '../../packages/cli/src/surface-authority-runtime.js';
import { decorateCliFirstPartyServices } from '../../packages/cli/src/first-party-services.js';

it('legacy Conquer keeps the successful push but skips prose when Forge is disabled', async () => {
  const previousExit = process.exitCode;
  vi.spyOn(core, 'ensureAgonHome').mockImplementation(() => {});
  vi.spyOn(core, 'loadConfig').mockReturnValue({ protectedPushBranches: [] } as ReturnType<typeof core.loadConfig>);
  vi.spyOn(core, 'createRunDir').mockReturnValue({ id: 'fixture', path: '/fixture/run' } as ReturnType<typeof core.createRunDir>);
  vi.spyOn(core, 'defaultBaseBranch').mockReturnValue('main');
  vi.spyOn(core, 'githubRepoUrl').mockReturnValue('');
  vi.spyOn(core.EngineRegistry.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(core.EngineRegistry.prototype, 'activeIds').mockReturnValue(['fixture']);
  vi.spyOn(core.EngineRegistry.prototype, 'resolveId').mockReturnValue('fixture');
  vi.spyOn(adapters, 'createCliAdapter').mockReturnValue({} as ReturnType<typeof adapters.createCliAdapter>);
  vi.spyOn(forge, 'createConquerIsolation').mockReturnValue({ repoRoot: '/fixture/root', branch: 'conquer/fixture', path: '/fixture/worktree' });
  vi.spyOn(forge, 'runConquer').mockResolvedValue({ done: true, lastClaim: 'verified', stopReason: 'done', turnsUsed: 1, consultsRun: 0 } as Awaited<ReturnType<typeof forge.runConquer>>);
  const draft = vi.spyOn(forge, 'runPrText').mockResolvedValue({ ok: true, title: 'unexpected', body: 'unexpected', engineId: 'fixture' });
  const git = vi.spyOn(core, 'spawnWithTimeout').mockImplementation(async options => ({
    exitCode: 0, stdout: options.args?.[0] === 'rev-parse' ? 'conquer/fixture' : '', stderr: '', durationMs: 1, timedOut: false,
  }));
  vi.spyOn(authority, 'captureProcessSurfaceAuthority').mockReturnValue(() => {});
  vi.spyOn(authority, 'assertProcessSurfaceAvailable').mockImplementation((_surface, id) => {
    if (id === 'forge') throw new Error('fixture Forge disabled');
  });
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.exitCode = undefined;
    await conquerCommand.run({ args: { task: 'fixture task', builder: 'fixture', gate: 'true', push: true } });
    expect(draft).not.toHaveBeenCalled();
    expect(git.mock.calls.filter(([options]) => options.args?.[0] === 'push')).toHaveLength(1);
    expect(output.mock.calls.flat().join('\n')).toContain('merge gate');
    expect(process.exitCode).toBeUndefined();
  } finally { process.exitCode = previousExit; vi.restoreAllMocks(); }
});

it('binds Conquer publication to kernel configuration rather than mod-owned configuration', async () => {
  const config = { protectedPushBranches: ['kernel-protected'], commitCoAuthor: '' } as ReturnType<typeof core.loadConfig>;
  const load = vi.spyOn(core, 'loadConfig').mockReturnValue(config);
  const format = vi.spyOn(core, 'appendAttribution').mockReturnValue('kernel-formatted');
  vi.spyOn(core.EngineRegistry.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(authority, 'captureProcessSurfaceAuthority').mockReturnValue(() => {});
  vi.spyOn(authority, 'assertProcessSurfaceAvailable').mockImplementation(() => {});
  try {
    const services = decorateCliFirstPartyServices({ id: 'agon.conquer' } as ModManifest, {} as ModServices) as ConquerModServices;
    const opened = await services.conquer!.open({ invocationId: 'policy-host', cwd: '/fixture-project',
      platform: 'darwin-arm64', signal: new AbortController().signal,
      config: { protectedPushBranches: ['mod-owned-decoy'], commitCoAuthor: 'decoy' } });
    expect(load).toHaveBeenCalledExactlyOnceWith('/fixture-project');
    expect(opened.publication!.protectedPushBranches).toEqual(['kernel-protected']);
    expect(opened.publication!.commitBody('verified claim')).toBe('kernel-formatted');
    expect(format).toHaveBeenCalledExactlyOnceWith('verified claim', config);
  } finally { vi.restoreAllMocks(); }
});

it.each(['enabled', 'disabled', 'retired-during'] as const)('guards optional Forge PR prose when %s', async state => {
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
    const services = decorateCliFirstPartyServices({ id: 'agon.conquer' } as ModManifest, {} as ModServices) as ConquerModServices;
    const opened = await services.conquer!.open({ invocationId: 'draft-host', cwd: '/fixture-project',
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

it('provides the terminal writer only to the CLI Brainstorm host and writes nothing during decoration', () => {
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  try {
    const services = decorateCliFirstPartyServices({ id: 'agon.brainstorm' } as ModManifest, {} as ModServices) as BrainstormModServices;
    expect(write).not.toHaveBeenCalled();
    expect(services.brainstorm?.writeCliOutput).toBeTypeOf('function');
    services.brainstorm!.writeCliOutput!('fixture stream\n');
    expect(write).toHaveBeenCalledExactlyOnceWith('fixture stream\n');
    const pipeline = decorateCliFirstPartyServices({ id: 'agon.pipeline-orchestration' } as ModManifest, {} as ModServices) as BrainstormModServices;
    expect(pipeline.brainstorm?.writeCliOutput).toBeUndefined();
    const conquer = decorateCliFirstPartyServices({ id: 'agon.conquer' } as ModManifest, {} as ModServices) as BrainstormModServices;
    expect(conquer.brainstorm?.open).toBeTypeOf('function');
    expect(conquer.brainstorm?.writeCliOutput).toBeUndefined();
    const unrelated = decorateCliFirstPartyServices({ id: 'agon.ask' } as ModManifest, {} as ModServices) as BrainstormModServices;
    expect(unrelated.brainstorm).toBeUndefined();
  } finally { write.mockRestore(); }
});
