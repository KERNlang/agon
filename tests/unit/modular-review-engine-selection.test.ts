import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntentContribution, InvocationContext, ModServices, Registrar } from '@kernlang/agon-mod-api';

const fixture = vi.hoisted(() => ({
  config: { hiddenEngines: [] as string[], removedEngines: [] as string[] },
  dispatch: vi.fn(),
  diff: 'diff --git a/file.ts b/file.ts\n+changed',
}));
vi.mock('@kernlang/agon-core', async importOriginal => {
  const core = await importOriginal<typeof import('@kernlang/agon-core')>();
  return {
    ...core,
    EngineRegistry: class extends core.EngineRegistry {
      override load() {
        for (const id of ['codex', 'kimi', 'ollama-coder', 'unavailable']) this.register({
          schemaVersion: 3, id, displayName: id, tier: 'user', isLocal: true,
          binary: id === 'unavailable' ? '/nonexistent/fixture-engine' : process.execPath,
          timeout: 10, exec: { args: [] },
        });
      }
    },
    loadConfig: () => fixture.config,
    createRunDir: () => ({ id: 'fixture', path: '/fixture/output' }),
  };
});
vi.mock('@kernlang/agon-adapter-cli', () => ({ createCliAdapter: () => ({ dispatch: fixture.dispatch }) }));
vi.mock('@kernlang/agon-support-verification', async importOriginal => ({
  ...await importOriginal<object>(),
  resolveReviewTarget: () => ({ diff: fixture.diff, label: 'fixture' }),
}));
vi.mock('../../packages/cli/src/patch-application-host.js', () => ({ patchApplicationHost: {} }));
vi.mock('@kernlang/agon-mod-plan', async importOriginal => ({
  ...await importOriginal<object>(), planSessionHost: {},
}));
vi.mock('../../packages/cli/src/bridge/serve-runtime.js', () => ({}));
vi.mock('../../packages/cli/src/commands/chrome.js', () => ({}));
vi.mock('../../packages/cli/src/commands/drive.js', () => ({}));
vi.mock('../../packages/cli/src/commands/ext.js', () => ({}));
vi.mock('../../packages/cli/src/commands/browser-host.js', () => ({}));

import { createCliEngineServices } from '../../packages/cli/src/first-party-services.js';
import { createMcpEngineServices } from '../../packages/mcp/src/first-party-services.js';
import { createMod, runReview } from '../../packages/mod-review/src/implementation.js';

beforeEach(() => {
  fixture.config = { hiddenEngines: [], removedEngines: [] };
  fixture.diff = 'diff --git a/file.ts b/file.ts\n+changed';
  fixture.dispatch.mockReset().mockResolvedValue({
    exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```',
    stderr: '', timedOut: false, durationMs: 1,
  });
});

describe.each([['CLI', createCliEngineServices], ['MCP', createMcpEngineServices]] as const)(
  '%s explicit Review selection through the real host and registry', (_surface, createEngines) => {
    const context: InvocationContext = {
      invocationId: 'review-selection', cwd: '/fixture', config: {},
      platform: 'darwin-arm64', signal: new AbortController().signal,
    };
    const services = (): ModServices => ({
      engines: createEngines(), receipts: { record: async () => 'fixture' },
    }) as ModServices;

    it('allows explicit Kimi while keeping default exclusions', async () => {
      const host = services();
      expect(await host.engines.listActive!(context)).toEqual(['codex']);
      const result = await runReview({ engines: 'codex,kimi,kimi' }, context, host);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(fixture.dispatch.mock.calls.map(([input]) => input.engine.id)).toEqual(['codex', 'kimi']);
    });

    it('allows explicitly named hidden engines', async () => {
      fixture.config.hiddenEngines = ['kimi'];
      const result = await runReview({ engine: 'kimi' }, context, services());
      expect(result.exitCode, result.stderr).toBe(0);
      expect(fixture.dispatch).toHaveBeenCalledOnce();
    });

    it.each(['removed', 'unknown', 'unavailable'])('rejects an %s reviewer before any seat dispatches', async state => {
      if (state === 'removed') fixture.config.removedEngines = ['kimi'];
      const id = state === 'removed' ? 'kimi' : state;
      const result = await runReview({ engines: `codex,${id}` }, context, services());
      expect(result.exitCode).toBe(1);
      expect(fixture.dispatch).not.toHaveBeenCalled();
    });

    it.each(['', ' ', 'codex,,kimi'])('rejects malformed explicit panel %j instead of choosing defaults', async engines => {
      const result = await runReview({ engines }, context, services());
      expect(result.exitCode).toBe(1);
      expect(fixture.dispatch).not.toHaveBeenCalled();
    });

    it.each(['unknown', 'unavailable', ''])('validates explicit reviewer %j even when the diff is empty', async engine => {
      fixture.diff = '';
      const result = await runReview({ engine }, context, services());
      expect(result.exitCode).toBe(1);
      expect(fixture.dispatch).not.toHaveBeenCalled();
    });

    it('rejects conflicting singular and plural selectors before dispatch', async () => {
      const result = await runReview({ engine: 'codex', engines: 'unknown' }, context, services());
      expect(result.exitCode).toBe(1);
      expect(fixture.dispatch).not.toHaveBeenCalled();
    });

    it('preserves order for explicitly named prefix-excluded reviewers', async () => {
      const result = await runReview({ engines: ' kimi,ollama-coder,codex,kimi ' }, context, services());
      expect(result.exitCode, result.stderr).toBe(0);
      expect(fixture.dispatch.mock.calls.map(([input]) => input.engine.id)).toEqual(['kimi', 'ollama-coder', 'codex']);
    });

    it.each(['abc', '0', '-1', '12junk'])('rejects invalid timeout %j before creating a run', async timeout => {
      const start = vi.fn();
      const result = await runReview({ engine: 'kimi', timeout }, context, { ...services(), runs: { start } } as unknown as ModServices);
      expect(result.exitCode).toBe(1);
      expect(start).not.toHaveBeenCalled();
      expect(fixture.dispatch).not.toHaveBeenCalled();
    });

    it('does not create a run for a rejected panel', async () => {
      const start = vi.fn();
      const result = await runReview({ engine: 'unknown' }, context, { ...services(), runs: { start } } as unknown as ModServices);
      expect(result.exitCode).toBe(1);
      expect(start).not.toHaveBeenCalled();
    });

    it.each(['kimi', 'unknown', 'unavailable'])('preserves parsed reviewer %s through intent execution', async engine => {
      let intent!: IntentContribution;
      const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
        if (method === 'intent') intent = args[0] as IntentContribution;
        return () => {};
      } }) as Registrar;
      const host = services();
      const dispose = await (await createMod(host)).activate(registrar, host);
      try {
        const parsed = intent.parse(`/review ${engine}`);
        expect(parsed).toBeDefined();
        const result = await intent.run(parsed!, context);
        expect(result.exitCode).toBe(engine === 'kimi' ? 0 : 1);
        expect(fixture.dispatch.mock.calls.map(([input]) => input.engine.id)).toEqual(engine === 'kimi' ? ['kimi'] : []);
      } finally { await dispose?.(); }
    });
  },
);
