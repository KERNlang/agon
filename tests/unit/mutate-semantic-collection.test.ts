import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engineHealth, spawnWithTimeout } from '@kernlang/agon-support-engine-runtime';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DispatchOptions, DispatchResult, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import { collectSemanticMutants } from '../../packages/forge/src/mutate-semantic.js';
import * as owner from '@kernlang/agon-mod-mutate';

const file = 'src/auth.ts';
const source = '  return token.valid;';
const proposal = { file, line: 2, before: source, after: 'return true;', why: 'bypass' };
const result = (stdout: string, extra: Partial<DispatchResult> = {}): DispatchResult => ({
  stdout, stderr: '', exitCode: 0, timedOut: false, durationMs: 0, ...extra,
});
function fixture(ids = ['fixture-good']) {
  const definitions = new Map(ids.map(id => [id, {
    schemaVersion: 1, id, displayName: id, isLocal: true, tier: 'user', timeout: 60,
    exec: { args: ['exec', '{prompt}'] },
  } as EngineDefinition]));
  const dispatch = vi.fn(async (_request: DispatchOptions) => result(JSON.stringify([proposal])));
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const opts = {
    targets: [{ file, lines: [{ line: 2, text: source }] }],
    sources: { [file]: ['function allowed(token) {', source, '}'] },
    engines: ids,
    registry: {
      get: (id: string) => { const def = definitions.get(id); if (!def) throw new Error('missing fixture'); return def; },
      findBinary: () => '/fixture/bin',
    } as Parameters<typeof collectSemanticMutants>[0]['registry'],
    adapter: { dispatch, isAvailable: async () => true, getVersion: async () => null },
    perEngine: 1, timeout: 80, outputDir: '/fixture/output', cwd: '/fixture/sandbox', lens: 'SECURITY',
    onEvent: (event: { type: string; data?: Record<string, unknown> }) => { events.push(event); },
  };
  return { opts, dispatch, definitions, events };
}

beforeEach(() => { engineHealth.clearAll(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { engineHealth.clearAll(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('legacy semantic collection contract', () => {
  it.each(['success', 'retry', 'timeout', 'abort'] as const)('reaps local fixture processes after %s', async mode => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-semantic-collection-'));
    const controller = new AbortController();
    const pids: number[] = [];
    const f = fixture();
    const fixtureText = JSON.stringify([proposal]);
    writeFileSync(join(cwd, 'proposal.json'), fixtureText);
    let attempts = 0;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    f.dispatch.mockImplementation(async request => {
      attempts += 1;
      const script = mode === 'timeout' || mode === 'abort' ? 'setInterval(() => {}, 1000)'
        : mode === 'retry' && attempts === 1 ? 'process.exit(1)'
          : "process.stdout.write(require('node:fs').readFileSync('proposal.json','utf8'))";
      return spawnWithTimeout({ command: process.execPath, args: ['-e', script],
        cwd: request.cwd, timeout: request.timeout * 1000, signal: request.signal,
        onSpawn: pid => { pids.push(pid); if (mode === 'abort') abortTimer = setTimeout(() => controller.abort(), 30); },
      });
    });
    try {
      const out = await collectSemanticMutants({ ...f.opts, cwd, outputDir: cwd,
        timeout: mode === 'timeout' ? 0.1 : 5, signal: controller.signal });
      expect(out.calls).toBe(mode === 'retry' || mode === 'timeout' ? 2 : 1);
      expect(out.mutants).toHaveLength(mode === 'success' || mode === 'retry' ? 1 : 0);
      expect(readFileSync(join(cwd, 'proposal.json'), 'utf8')).toBe(fixtureText);
      expect(pids).toHaveLength(out.calls);
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      clearTimeout(abortTimer);
      controller.abort();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('delegates collection to the physical owner with the host configuration loader', async () => {
    const collect = vi.spyOn(owner, 'collectSemanticMutants');
    const f = fixture();
    const out = await collectSemanticMutants(f.opts);
    expect(collect).toHaveBeenCalledWith(f.opts, { loadConfig: expect.any(Function) });
    expect(out.mutants).toHaveLength(1);
  });

  it('retains prompt, dispatch authority, result identity and event ordering', async () => {
    const f = fixture();
    const abort = new AbortController();
    const out = await collectSemanticMutants({ ...f.opts, signal: abort.signal });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    const request = f.dispatch.mock.calls[0][0];
    expect(request).toMatchObject({ engine: f.definitions.get('fixture-good'), textOnly: true,
      cwd: f.opts.cwd, outputDir: f.opts.outputDir, mode: 'exec', timeout: 80, signal: abort.signal });
    expect(request.prompt).toContain('FOCUS: propose bugs of this kind first: auth bypass');
    expect(request.prompt).toContain(`2\t${source}`);
    expect(request.systemPrompt).toContain('Do not use tools, read files, or run commands.');
    expect(out).toMatchObject({ calls: 1, dropped: [], panelHealth: { requested: 1, responded: 1, degraded: false },
      mutants: [{ id: 'semantic:fixture-good@src/auth.ts:L2#1', before: source, after: '  return true;',
        rationale: 'bypass', lens: 'security', engine: 'fixture-good' }] });
    expect(f.events.map(e => e.type)).toEqual(['mutate:semantic-dispatch', 'mutate:semantic-parsed']);
  });

  it('does not dispatch for empty or test-only targets', async () => {
    const f = fixture();
    const out = await collectSemanticMutants({ ...f.opts, targets: [{ file: 'auth.test.ts', lines: [{ line: 2, text: source }] }] });
    expect(out).toEqual({ mutants: [], dropped: [], calls: 0,
      panelHealth: { requested: 0, responded: 0, degraded: false, notes: [], banner: null } });
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('reports quarantined, write-capable and missing seats without dispatching them', async () => {
    const f = fixture(['fixture-quarantine', 'fixture-write', 'fixture-missing']);
    engineHealth.mark('fixture-quarantine', 'unreachable', 'fixture unavailable');
    f.definitions.get('fixture-write')!.exec!.args.push('--dangerously-skip-permissions');
    f.definitions.delete('fixture-missing');
    const out = await collectSemanticMutants(f.opts);
    expect(out).toMatchObject({ mutants: [], calls: 0, panelHealth: { requested: 3, responded: 0, degraded: true } });
    expect(out.panelHealth.notes.join('\n')).toContain('fixture unavailable');
    expect(out.panelHealth.notes.join('\n')).toContain('write-capable');
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('retries transient timeout once and counts actual attempts with partial failure', async () => {
    const f = fixture(['fixture-good', 'fixture-failed']);
    const attempts = new Map<string, number>();
    f.dispatch.mockImplementation(async request => {
      const id = request.engine.id;
      attempts.set(id, (attempts.get(id) ?? 0) + 1);
      return id === 'fixture-good' && attempts.get(id) === 2
        ? result(JSON.stringify([proposal])) : result('', { timedOut: true });
    });
    const out = await collectSemanticMutants(f.opts);
    expect(out).toMatchObject({ calls: 4, panelHealth: { requested: 2, responded: 1, degraded: true } });
    expect(out.mutants).toHaveLength(1);
    expect(f.dispatch.mock.calls.filter(([r]) => r.engine.id === 'fixture-good').map(([r]) => r.timeout)).toEqual([80, 40]);
  });

  it('does not retry after cancellation and forwards the same signal', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.dispatch.mockImplementation(async request => {
      expect(request.signal).toBe(controller.signal);
      controller.abort();
      return result('', { timedOut: true });
    });
    expect(await collectSemanticMutants({ ...f.opts, signal: controller.signal })).toMatchObject({ calls: 1, mutants: [] });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    f.dispatch.mockClear();
    expect(await collectSemanticMutants({ ...f.opts, signal: controller.signal })).toMatchObject({ calls: 0, mutants: [] });
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('keeps target containment and rejected-entry diagnostics', async () => {
    const f = fixture();
    f.dispatch.mockResolvedValue(result(JSON.stringify([
      { ...proposal, line: 1, before: 'function allowed(token) {' },
      proposal,
      { ...proposal, after: 'return false;' },
    ])));
    const out = await collectSemanticMutants(f.opts);
    expect(out.mutants).toHaveLength(1);
    expect(out.dropped.map(d => d.reason)).toEqual([
      expect.stringContaining('outside the requested target lines'), expect.stringContaining('over the per-engine cap'),
    ]);
    expect(f.events.at(-1)?.data).toEqual({ engineId: 'fixture-good', accepted: 1, dropped: 2 });
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('reports malformed successful responses separately from failed seats', async () => {
    const f = fixture();
    f.dispatch.mockResolvedValue(result('no proposals here'));
    const out = await collectSemanticMutants(f.opts);
    expect(out).toMatchObject({ calls: 1, mutants: [], panelHealth: { responded: 1 },
      dropped: [{ engine: 'fixture-good', reason: 'no JSON array found in the response' }] });
  });
});
