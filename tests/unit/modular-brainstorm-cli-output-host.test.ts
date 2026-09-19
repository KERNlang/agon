import { expect, it, vi } from 'vitest';
import type { ModManifest, ModServices } from '@kernlang/agon-mod-api';
import type { BrainstormModServices } from '@kernlang/agon-mod-brainstorm';
import { decorateCliFirstPartyServices } from '../../packages/cli/src/first-party-services.js';

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
    const unrelated = decorateCliFirstPartyServices({ id: 'agon.ask' } as ModManifest, {} as ModServices) as BrainstormModServices;
    expect(unrelated.brainstorm).toBeUndefined();
  } finally { write.mockRestore(); }
});
