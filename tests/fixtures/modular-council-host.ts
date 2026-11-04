import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import type { DispatchResult, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import type { CouncilModServices } from '../../packages/mod-council/src/host.js';

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

/** Run the owned Council algorithm with local dispatch and run directories. */
export function withCouncilFixtureHost(services: CouncilModServices): CouncilModServices {
  return {
    ...services,
    runs: services.runs ?? {
      start: async () => {
        const path = mkdtempSync(join(tmpdir(), 'agon-council-fixture-'));
        directories.push(path);
        return { id: 'fixture', path, mode: 'council', startedAt: 'fixture' };
      },
      finish: async () => {}, writeArtifact: async () => {},
    },
    council: { open: async context => {
      const ids = services.engines.listActive ? [...await services.engines.listActive(context)] : [];
      const ranked = services.engines.rank ? await services.engines.rank(ids, ['tribunal'], context) : [];
      const assertCurrent = () => { context.signal.throwIfAborted(); context.assertCurrent?.(); };
      return {
        assertCurrent, activeEngineIds: ids, defaultEngineIds: ids, removedEngineIds: [],
        registry: { listIds: () => ids, resolveId: id => id,
          get: id => ({ id, name: id, command: 'fixture' } as EngineDefinition), findBinary: () => null },
        adapter: {
          dispatch: async options => await services.engines.dispatch(options.engine.id, options.prompt, context,
            { timeoutSeconds: options.timeout, systemPrompt: options.systemPrompt }) as unknown as DispatchResult,
          isAvailable: async () => true, getVersion: async () => null,
        },
        effects: {
          assertCurrent, loadConfig: () => ({}), warn: () => {}, recordRatings: () => {},
          readSeating: () => ({
            pick: candidates => {
              const first = ranked.find(engine => candidates.includes(engine.engineId));
              return { engineId: first?.engineId ?? candidates[0], reason: first?.reason ?? 'random' };
            },
            rank: candidates => [...ranked.map(engine => engine.engineId).filter(id => candidates.includes(id)),
              ...candidates.filter(id => !ranked.some(engine => engine.engineId === id))],
          }),
        },
      };
    } },
  };
}
