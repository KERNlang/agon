import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCesarToolRegistry } from '../../packages/cli/src/cesar/tools.js';
import {
  disposeProcessSurfaceAuthority,
  executeProcessCesarRoute,
  initializeProcessSurfaceAuthority,
  processSurfaceCatalog,
  processSurfaceClient,
} from '../../packages/cli/src/surface-authority-runtime.js';
import { runPhysicalCesarWorkflow } from '../../packages/cli/src/signals/dispatch/cesar-router.js';
import type { ModServices } from '@kernlang/agon-mod-api';

const root = mkdtempSync(join(tmpdir(), 'agon-cesar-parity-'));

beforeAll(() => initializeProcessSurfaceAuthority(join(root, 'host')));
afterAll(async () => {
  await disposeProcessSurfaceAuthority();
  rmSync(root, { recursive: true, force: true });
});

const valid: Readonly<Record<string, Record<string, unknown>>> = Object.freeze({
  Forge: { task: 'implement it', scope: 'slice', fitnessCmd: 'npm test', hardened: true, team: false },
  Brainstorm: { question: 'what are the options?', team: true },
  Tribunal: { question: 'A or B?', mode: 'red-team', team: false },
  Campfire: { topic: 'explore the architecture' },
  Council: { question: 'ship it?', roles: ['security'], chairman: 'codex' },
  Pipeline: { task: 'review and fix', fitnessCmd: 'npm test', engines: ['codex'] },
  Review: { target: 'uncommitted', engines: ['codex', 'claude'] },
  Agent: { task: 'make the change', team: true, engines: ['codex'], taskKind: 'edit', maxTurns: 8 },
  Goal: { intent: 'finish the queue', queue: 'tasks', gate: 'npm test', engines: ['codex'] },
  Conquer: { task: 'finish the build', gate: 'npm test', builder: 'codex', engines: ['claude'], maxTurns: 12 },
  Delegate: { engine: 'codex', task: 'inspect this', mode: 'review' },
  QuickNero: { reason: 'uncertain premise' },
});

const readOnly = new Set(['Forge', 'Brainstorm', 'Tribunal', 'Campfire', 'Council', 'Review', 'Delegate', 'QuickNero']);

describe('physical Cesar orchestration tool parity', () => {
  it('keeps the host handoff schemas, effects, and no-prompt permission behavior', () => {
    const registry = createCesarToolRegistry('codex');
    for (const [name, input] of Object.entries(valid)) {
      const handler = registry.get(name);
      expect(handler, name).toBeDefined();
      expect(handler!.validate(input, {} as never), name).toBeNull();
      expect(handler!.checkPermission(input, {} as never).behavior, name).toBe('allow');
      expect(handler!.definition.isReadOnly, name).toBe(readOnly.has(name));
      expect(handler!.definition.isConcurrencySafe, name).toBe(readOnly.has(name));
    }
  });

  it('retains array-shaped engine and role fields used by the delegation router', () => {
    const registry = createCesarToolRegistry('codex');
    for (const name of ['Agent', 'Goal', 'Conquer', 'Pipeline', 'Review']) {
      expect(registry.get(name)!.validate(valid[name], {} as never), name).toBeNull();
    }
    expect(registry.get('Council')!.validate(valid.Council, {} as never)).toBeNull();
    expect(registry.get('Agent')!.validate({ task: 'x', engines: 'codex' }, {} as never)).toMatch(/schema/);
    expect(registry.get('Council')!.validate({ question: 'x', roles: 'security' }, {} as never)).toMatch(/schema/);
  });

  it('executes handoff tools as bounded signals rather than starting nested workflows', async () => {
    const registry = createCesarToolRegistry('codex');
    for (const name of ['Forge', 'Brainstorm', 'Tribunal', 'Campfire', 'Council', 'Pipeline', 'Review', 'Agent', 'Goal', 'Conquer', 'QuickNero']) {
      const result = await registry.get(name)!.execute(valid[name], {
        cwd: root,
        readFileState: new Map(),
        abortSignal: new AbortController().signal,
      } as never);
      expect(result.ok, name).toBe(true);
      expect(result.content, name).toMatch(/[Dd]elegation accepted|self-check scheduled/);
    }
  });

  it('executes the post-handoff workflow through its physical owner-tagged route', async () => {
    await disposeProcessSurfaceAuthority();
    const dispatches: string[] = [];
    await initializeProcessSurfaceAuthority(join(root, 'physical-route-host'), (_manifest, base): ModServices => withBrainstormFixtureHost({
      ...base,
      engines: Object.freeze({
        listActive: async () => ['fixture-engine', 'fixture-peer'],
        dispatch: async (engineId: string, prompt: string) => {
          dispatches.push(engineId);
          const stdout = prompt.includes('Multiple AI engines analyzed') ? 'physical route' : prompt.includes('Synthesize one accountable')
            ? 'RECOMMENDATION\nConfidence: 91%\nUse the physical route.'
            : prompt.includes('Return one JSON object') || prompt.includes('confidence')
              ? '{"approach":"physical route","confidence":91,"steps":[],"tradeoffs":[]}'
              : 'physical route evidence';
          return { engineId, exitCode: 0, stdout, stderr: '', timedOut: false };
        },
      }),
    }));
    const result = await executeProcessCesarRoute('brainstorm', { question: 'prove ownership' }, {
      cwd: root,
      signal: new AbortController().signal,
    }) as any;
    expect(result).toMatchObject({ exitCode: 0, result: { winner: 'fixture-engine', response: 'physical route' } });
    expect(dispatches).toEqual(['fixture-engine', 'fixture-peer', 'fixture-engine']);

    const rendered: unknown[] = [];
    const routed = await runPhysicalCesarWorkflow('brainstorm', { question: 'prove shipped-path ownership' }, {
      dispatch: (event: unknown) => rendered.push(event),
    } as any);
    expect(routed).toMatchObject({ winner: 'fixture-engine', response: 'physical route' });
    expect(rendered).toContainEqual(expect.objectContaining({ type: 'engine-block', engineId: 'brainstorm', content: 'physical route' }));

    const council = await executeProcessCesarRoute('council', { question: 'prove physical-only route' }, {
      cwd: root,
      signal: new AbortController().signal,
    }) as any;
    expect(council).toMatchObject({ exitCode: 0, result: { chairmanId: 'fixture-engine', verdict: expect.stringContaining('RECOMMENDATION') } });
  });

  it('registers every physical Cesar execution entry with the exact plan-step kind', () => {
    const projected = processSurfaceClient('cesar').project().entries;
    const entries = processSurfaceCatalog('cesar').filter((entry) =>
      entry.ownerClass === 'user-toggleable-mod-package'
      && (entry.category === 'cesarRoutes' || entry.category === 'physicalCesarRoutes'));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.kind, entry.registryId).toBe('plan-step');
      expect(projected.some((record) => record.kind === 'plan-step'
        && record.id === entry.registryId
        && record.owner.id === entry.owner.id), entry.registryId).toBe(true);
    }
  });
});
import { withBrainstormFixtureHost } from '../fixtures/modular-brainstorm-host.js';
