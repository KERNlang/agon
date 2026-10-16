import { expect, it, vi } from 'vitest';
import type { ModManifest, ModServices } from '@kernlang/agon-mod-api';
import type { BrainstormModServices } from '@kernlang/agon-mod-brainstorm';
import type { ConquerModServices } from '@kernlang/agon-mod-conquer';
import * as core from '@kernlang/agon-core';
import * as authority from '../../packages/cli/src/surface-authority-runtime.js';
import { decorateCliFirstPartyServices } from '../../packages/cli/src/first-party-services.js';

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
