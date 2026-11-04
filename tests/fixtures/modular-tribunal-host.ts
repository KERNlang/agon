import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import type { DispatchResult, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import type { TribunalModServices } from '../../packages/mod-tribunal/src/host.js';

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

/** Keep the real Tribunal runtime, retry policy and sidechain writes. */
export function withTribunalFixtureHost(services: TribunalModServices): TribunalModServices {
  return {
    ...services,
    runs: services.runs ?? {
      start: async mode => {
        const path = mkdtempSync(join(tmpdir(), 'agon-tribunal-fixture-'));
        directories.push(path);
        return { id: 'fixture', path, mode, startedAt: 'fixture' };
      },
      finish: async () => {}, writeArtifact: async () => {},
    },
    tribunal: { open: context => ({
      assertCurrent: () => context.signal.throwIfAborted(),
      registry: {
        get: id => {
          if (id === 'claude') throw new Error('No configured fixture judge');
          return { id, name: id, command: 'fixture' } as EngineDefinition;
        },
        findBinary: () => null,
      },
      adapter: {
        dispatch: async options => await services.engines.dispatch(options.engine.id, options.prompt, context,
          { timeoutSeconds: options.timeout, systemPrompt: options.systemPrompt }) as unknown as DispatchResult,
      },
      effects: {
        assertCurrent: () => context.signal.throwIfAborted(),
        loadConfig: () => ({}), seedRegistry: () => {},
        classifyTask: () => 'general', updateRanked: () => {},
      },
    }) },
  };
}
