import { describe, expect, it, vi } from 'vitest';
import type { ModServices, ModManifest } from '@kernlang/agon-mod-api';

const assets = vi.hoisted(() => ({ resolve: vi.fn(() => '/fixture/owned-engine-assets'), load: vi.fn() }));
vi.mock('@kernlang/agon-support-engine-runtime', () => ({ resolveEngineDefinitionsDir: assets.resolve }));
vi.mock('@kernlang/agon-core', () => ({
  EngineRegistry: class {
    load = assets.load;
    activeIds() { return ['codex']; }
  },
  loadConfig: () => ({}), createRunDir: vi.fn(), getRatings: vi.fn(),
  pickTopRatedEngine: vi.fn(), writeRunStatus: vi.fn(),
}));
import { decorateMcpFirstPartyServices } from '../../packages/mcp/src/first-party-services.js';

describe('MCP engine asset ownership', () => {
  it('uses the support package resolver rather than a server-relative checkout fallback', async () => {
    const services = decorateMcpFirstPartyServices({ id: 'agon.think' } as ModManifest, {} as ModServices);
    expect(await services.engines.listActive!({ cwd: '/fixture' } as never)).toEqual(['codex']);
    expect(assets.resolve).toHaveBeenCalled();
    expect(assets.load).toHaveBeenCalledWith('/fixture/owned-engine-assets');
  });
});
