import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
import { dispatchOrchestrationIntent } from '../../packages/cli/src/signals/dispatch/intent-orchestration.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';
import { ModStateStore } from '../../packages/mod-kernel/src/index.js';
import type { ModServices } from '@kernlang/agon-mod-api';
import { executeToolCall, getProjectFileStateCache } from '@kernlang/agon-core';

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
  it('confirms each project-memory write and refreshes the read-before-write cache', async () => {
    const cwd = mkdtempSync(join(root, 'memory-'));
    const path = join(cwd, '.agon', 'project.md');
    const registry = createCesarToolRegistry();
    const input = { memory: 'Use session tokens', section: 'Decisions' };
    const cache = new Map(getProjectFileStateCache(cwd).cache);
    const context = { cwd, readFileState: cache, abortSignal: new AbortController().signal } as never;
    expect(registry.get('SaveMemory')!.checkPermission(input, context).behavior).toBe('ask');
    const call = { id: 'memory-fixture', name: 'SaveMemory', input };
    expect((await executeToolCall(call, context, registry, async () => false)).result.ok).toBe(false);
    expect((await executeToolCall(call, context, registry)).result.ok).toBe(false);
    expect(existsSync(path)).toBe(false);
    const saved = await executeToolCall(call, context, registry, async () => true);
    expect(saved.result.ok).toBe(true);
    expect(saved.result.content).toContain('Saved to project memory [Decisions]');
    expect(readFileSync(path, 'utf8')).toContain('Use session tokens');
    expect(cache.get(path)).toMatchObject({ lastTouchedBy: 'save-memory', isPartialView: false });
    expect(cache.get(path)?.content.trim()).toBe(readFileSync(path, 'utf8').trim());
  });

  it.each(['cancel', 'replace'] as const)('rejects project-memory approval after %s', async action => {
    const cwd = mkdtempSync(join(root, 'memory-stale-'));
    const registry = createCesarToolRegistry();
    const controller = new AbortController();
    const context = { cwd, readFileState: new Map(), abortSignal: controller.signal } as never;
    const result = await executeToolCall({
      id: 'stale-memory', name: 'SaveMemory',
      input: { memory: 'Must not be saved', section: 'Decisions' },
    }, context, registry, async () => {
      if (action === 'cancel') controller.abort();
      else {
        await disposeProcessSurfaceAuthority();
        await initializeProcessSurfaceAuthority(join(root, 'host'));
      }
      return true;
    });
    expect(result.result.ok).toBe(false);
    expect(existsSync(join(cwd, '.agon', 'project.md'))).toBe(false);
  });

  it('rejects a generation change during the project-memory write-grant check', async () => {
    const cwd = mkdtempSync(join(root, 'memory-grant-'));
    const host = join(cwd, 'host');
    await disposeProcessSurfaceAuthority();
    try {
      await initializeProcessSurfaceAuthority(host, (manifest, base) => manifest.id !== 'agon.memory' ? base : {
        ...base, permissions: { check: async () => {
          mkdirSync(host, { recursive: true });
          writeFileSync(join(host, 'current-generation.json'), '{}');
          return 'allow' as const;
        } },
      });
      const registry = createCesarToolRegistry();
      const result = await executeToolCall({
        id: 'memory-grant', name: 'SaveMemory',
        input: { memory: 'Must not be saved', section: 'Decisions' },
      }, { cwd, readFileState: new Map(), abortSignal: new AbortController().signal } as never,
      registry, async () => true);
      expect(result.result.ok).toBe(false);
      expect(result.result.error).toMatch(/generation changed/);
      expect(existsSync(join(cwd, '.agon', 'project.md'))).toBe(false);
    } finally {
      await disposeProcessSurfaceAuthority();
      await initializeProcessSurfaceAuthority(join(root, 'host'));
    }
  });

  it('runs TUI Goal start, status and resume through real registry and storage', async () => {
    const cwd = join(root, 'goal-repo'); mkdirSync(cwd);
    const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(cwd, 'base.txt'), 'base\n'); git('add', 'base.txt'); git('commit', '-m', 'base');
    const jobs: Array<(signal: AbortSignal) => Promise<unknown>> = [];
    const events: Array<{ type: string; content?: string }> = [];
    const cb = { ctx: {}, dispatch: (event: { type: string; content?: string }) => events.push(event),
      runAsJob: (_kind: string, _label: string, run: (signal: AbortSignal) => Promise<unknown>) => jobs.push(run),
    } as unknown as DispatchCallbacks;
    const invoke = async (input: string) => {
      await dispatchOrchestrationIntent({ type: 'goal', input }, `/goal ${input}`, cb);
      await jobs.at(-1)!(new AbortController().signal);
    };
    await invoke(`"TUI fixture" --cwd ${JSON.stringify(cwd)} --gate true --max-hours 2 --dry-run`);
    const store = new ModStateStore(join(root, 'host'), 'agon.goal');
    const before = await store.read('goals/tui-fixture') as any;
    expect(before.payload).toMatchObject({ intent: 'TUI fixture', maxHours: 2, gate: 'true', tasks: [expect.objectContaining({ attempts: 0 })] });
    await invoke(`--status --id tui-fixture --cwd ${JSON.stringify(cwd)}`);
    expect(await store.read('goals/tui-fixture')).toEqual(before);
    await invoke(`--resume --id tui-fixture --cwd ${JSON.stringify(cwd)} --dry-run`);
    expect((await store.read('goals/tui-fixture') as any).payload.tasks).toEqual(before.payload.tasks);
    expect(events.filter(event => event.type === 'engine-block')).toHaveLength(3);
  });

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
    await initializeProcessSurfaceAuthority(join(root, 'physical-route-host'), (manifest, base): ModServices => (manifest.id === 'agon.council' ? withCouncilFixtureHost : withBrainstormFixtureHost)({
      ...base,
      engines: Object.freeze({
        listActive: async () => ['fixture-engine', 'fixture-peer'],
        dispatch: async (engineId: string, prompt: string) => {
          dispatches.push(engineId);
          const stdout = prompt.includes('Multiple AI engines analyzed') ? 'physical route' : prompt.includes('Synthesize the advisors below into ONE decision')
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
    expect(rendered).toContainEqual(expect.objectContaining({ type: 'engine-block', engineId: 'fixture-engine', content: 'physical route' }));
    expect(rendered).toContainEqual(expect.objectContaining({ type: 'progress-update' }));
    expect(rendered).toContainEqual(expect.objectContaining({ type: 'kern-draft', engineId: 'fixture-engine' }));
    expect(rendered).toContainEqual(expect.objectContaining({ type: 'info', message: 'Dedup unavailable: fixture' }));
    expect(rendered.at(-1)).toEqual({ type: 'progress-clear' });
    const controller = new AbortController();
    controller.abort(new Error('fixture cancelled'));
    const cancelled: unknown[] = [];
    const callsBefore = dispatches.length;
    await expect(runPhysicalCesarWorkflow('brainstorm', { question: 'cancelled run' }, {
      dispatch: (event: unknown) => cancelled.push(event),
    } as any, controller.signal)).rejects.toThrow('fixture cancelled');
    expect(dispatches).toHaveLength(callsBefore);
    expect(cancelled).toEqual([{ type: 'progress-clear' }]);

    const council = await executeProcessCesarRoute('council', { question: 'prove physical-only route' }, {
      cwd: root,
      signal: new AbortController().signal,
    }) as any;
    expect(council).toMatchObject({ exitCode: 0, result: { chairmanId: 'fixture-engine', verdict: expect.stringContaining('RECOMMENDATION') } });
    const selectedCouncil = await executeProcessCesarRoute('council', {
      question: 'preserve seating', roles: 'security', chairman: 'fixture-peer',
    }, { cwd: root, signal: new AbortController().signal }) as any;
    expect(selectedCouncil).toMatchObject({ exitCode: 0, result: {
      chairmanId: 'fixture-peer', chairmanReason: 'forced',
      seats: [{ engineId: 'fixture-engine', role: 'security' }],
    } });
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
import { withCouncilFixtureHost } from '../fixtures/modular-council-host.js';
