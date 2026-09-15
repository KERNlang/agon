import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineDispatchOptions, InvocationContext } from '@kernlang/agon-mod-api';

// Stop at the adapter boundary: no engine process, personal configuration or
// run directory is needed to test the actual CLI and MCP host implementations.
const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  brainstorm: { open: vi.fn() },
  loadConfig: vi.fn(() => ({})),
  engine: { id: 'fixture-engine' },
}));
vi.mock('@kernlang/agon-core', () => ({
  EngineRegistry: class {
    load() {}
    activeIds() { return ['fixture-engine']; }
    get() { return fixture.engine; }
  },
  loadConfig: fixture.loadConfig,
  createBrainstormHostServices: () => fixture.brainstorm,
  createRunDir: () => ({ id: 'fixture-run', path: '/fixture/output' }),
  getRatings: vi.fn(), pickTopRatedEngine: vi.fn(), writeRunStatus: vi.fn(),
  eventLogFlush: vi.fn(), setSessionRoot: vi.fn(),
}));
vi.mock('@kernlang/agon-adapter-cli', () => ({ createCliAdapter: () => ({ dispatch: fixture.dispatch }) }));
vi.mock('@kernlang/agon-support-engine-runtime', () => ({ resolveEngineDefinitionsDir: () => '/fixture/engines' }));
vi.mock('../../packages/cli/src/lib/engines-dir.js', () => ({ resolveBuiltinEnginesDir: () => '/fixture/engines' }));
vi.mock('../../packages/cli/src/handlers/engine-filter.js', () => ({ filterDefaultOrchestrationEngines: (ids: string[]) => ids }));
vi.mock('../../packages/cli/src/patch-application-host.js', () => ({ patchApplicationHost: {} }));
vi.mock('../../packages/cli/src/plan-session-host.js', () => ({ planSessionHost: {} }));
vi.mock('../../packages/cli/src/bridge/serve-runtime.js', () => ({}));
vi.mock('../../packages/cli/src/commands/chrome.js', () => ({}));
vi.mock('../../packages/cli/src/commands/drive.js', () => ({}));
vi.mock('../../packages/cli/src/commands/ext.js', () => ({}));
vi.mock('../../packages/cli/src/commands/browser-host.js', () => ({}));

import { createCliEngineServices, decorateCliFirstPartyServices } from '../../packages/cli/src/first-party-services.js';
import { createMcpEngineServices, decorateMcpFirstPartyServices } from '../../packages/mcp/src/first-party-services.js';

const result = { exitCode: 0, stdout: 'fixture answer', stderr: '', durationMs: 4, timedOut: false };
beforeEach(() => { vi.clearAllMocks(); fixture.dispatch.mockResolvedValue(result); });

describe.each([decorateCliFirstPartyServices, decorateMcpFirstPartyServices])('Brainstorm host wiring', decorate => {
  it.each(['agon.brainstorm', 'agon.pipeline-orchestration'])('provides host effects to the bundled %s consumer', id => {
    const services = decorate({ id } as never, {} as never);
    const expected = decorate === decorateCliFirstPartyServices && id === 'agon.brainstorm'
      ? { ...fixture.brainstorm, writeCliOutput: expect.any(Function) }
      : fixture.brainstorm;
    expect(services).toHaveProperty('brainstorm', expected);
    expect(fixture.brainstorm.open).not.toHaveBeenCalled();
  });
  it('does not expose the capability to unrelated mods', () => {
    expect(decorate({ id: 'custom.example' } as never, {} as never)).not.toHaveProperty('brainstorm');
  });
});

describe.each([
  ['CLI', createCliEngineServices],
  ['MCP', createMcpEngineServices],
] as const)('%s engine dispatch contract', (_surface, createServices) => {
  const context: InvocationContext = {
    invocationId: 'fixture-invocation', cwd: '/fixture/project',
    platform: 'darwin-arm64', signal: new AbortController().signal, config: {},
  };

  it.each([true, false, undefined])('preserves textOnly=%s without changing the rest of dispatch', async textOnly => {
    const options: EngineDispatchOptions = { textOnly, timeoutSeconds: 37, systemPrompt: 'fixture system', mode: 'review' };
    const actual = await createServices().dispatch('fixture-engine', 'fixture prompt', context, options);
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({
      engine: fixture.engine, prompt: 'fixture prompt', cwd: context.cwd,
      outputDir: '/fixture/output', timeout: 37, systemPrompt: 'fixture system',
      mode: 'review', signal: context.signal, textOnly,
    });
    expect(fixture.loadConfig).toHaveBeenCalledWith(context.cwd);
    expect(actual).toEqual({ ...result, engineId: 'fixture-engine', outputDir: '/fixture/output' });
  });

  it('preserves default selection, execution mode and timeout', async () => {
    await createServices().dispatch('', 'fixture prompt', context);
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({
      engine: fixture.engine, prompt: 'fixture prompt', cwd: context.cwd,
      outputDir: '/fixture/output', timeout: 120, systemPrompt: undefined,
      mode: 'exec', signal: context.signal, textOnly: undefined,
    });
  });

  it('preserves failures instead of manufacturing a successful answer', async () => {
    const error = new Error('fixture adapter failure');
    fixture.dispatch.mockRejectedValueOnce(error);
    const options: EngineDispatchOptions = { mode: 'agent' };
    await expect(createServices().dispatch('fixture-engine', 'fixture prompt', context, options)).rejects.toBe(error);
  });
});
