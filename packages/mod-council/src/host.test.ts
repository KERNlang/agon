import { describe, expect, it, vi } from 'vitest';
import type { InvocationContext } from '@kernlang/agon-mod-api';
import type { EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import { createCouncilHostServices } from './host.js';

function fixture() {
  let current = true;
  const controller = new AbortController();
  const check = () => { if (!current) throw new Error('retired'); };
  const context: InvocationContext = { invocationId: 'council-host', cwd: '/isolated/council',
    platform: 'darwin-arm64', signal: controller.signal, config: {}, assertCurrent: check };
  const registry = { get: (id: string) => ({ id } as EngineDefinition),
    findBinary: () => null, listIds: () => ['alpha'], resolveId: (id: string) => id };
  const selection = { activeEngineIds: ['alpha'], defaultEngineIds: ['alpha'], removedEngineIds: [] as string[] };
  const seating = { pick: vi.fn(() => ({ engineId: 'alpha', reason: 'rated' })), rank: vi.fn((ids: string[]) => ids) };
  const effects = {
    captureAuthority: () => check, openRegistry: vi.fn(() => registry),
    selectEngines: vi.fn(() => selection),
    createAdapter: vi.fn(() => ({ dispatch: vi.fn(), isAvailable: vi.fn(), getVersion: vi.fn() })),
    loadConfig: vi.fn(() => ({})), readSeating: vi.fn(() => seating),
    recordRatings: vi.fn(), warn: vi.fn(),
  };
  return { context, controller, registry, selection, seating, effects,
    retire: () => { current = false; }, host: createCouncilHostServices(effects) };
}

describe('Council invocation host', () => {
  it('captures cwd, registry and immutable engine selection', async () => {
    const h = fixture(); const session = await h.host.open(h.context);
    h.selection.activeEngineIds.push('later');
    expect(session.activeEngineIds).toEqual(['alpha']);
    expect(Object.isFrozen(session.activeEngineIds)).toBe(true);
    session.effects.loadConfig('/different');
    session.effects.readSeating(h.registry);
    expect(h.effects.loadConfig).toHaveBeenCalledWith('/isolated/council');
    expect(h.effects.readSeating).toHaveBeenCalledWith(h.registry);
  });

  it('rejects cancelled opens before registry access', async () => {
    const h = fixture(); h.controller.abort(new Error('cancelled'));
    await expect(async () => h.host.open(h.context)).rejects.toThrow('cancelled');
    expect(h.effects.openRegistry).not.toHaveBeenCalled();
  });

  it('checks invocation authority separately from generation authority', async () => {
    const h = fixture();
    const context = { ...h.context, assertCurrent: () => { throw new Error('invocation revoked'); } };
    await expect(async () => h.host.open(context)).rejects.toThrow('invocation revoked');
    expect(h.effects.openRegistry).not.toHaveBeenCalled();
  });

  it('blocks effects and retained seating after generation retirement', async () => {
    const h = fixture(); const session = await h.host.open(h.context);
    const seating = session.effects.readSeating(h.registry); h.retire();
    expect(() => seating.pick(['alpha'], ['tribunal'])).toThrow('retired');
    expect(() => seating.rank(['alpha'])).toThrow('retired');
    expect(() => session.effects.recordRatings('Q', [])).toThrow('retired');
    expect(() => session.effects.warn('late')).toThrow('retired');
    await expect(session.adapter.isAvailable(h.registry.get('alpha'))).rejects.toThrow('retired');
    expect(h.effects.recordRatings).not.toHaveBeenCalled();
    expect(h.effects.warn).not.toHaveBeenCalled();
    expect(h.seating.pick).not.toHaveBeenCalled();
  });

  it.each(['openRegistry', 'selectEngines', 'loadConfig', 'readSeating'] as const)(
    'stops when %s retires the generation', async boundary => {
      const h = fixture();
      const original = h.effects[boundary].getMockImplementation()!;
      h.effects[boundary].mockImplementation((() => { h.retire(); return original(); }) as never);
      if (boundary === 'openRegistry' || boundary === 'selectEngines') {
        await expect(async () => h.host.open(h.context)).rejects.toThrow('retired');
        expect(h.effects.createAdapter).not.toHaveBeenCalled();
        if (boundary === 'openRegistry') expect(h.effects.selectEngines).not.toHaveBeenCalled();
      } else {
        const session = await h.host.open(h.context);
        expect(() => boundary === 'loadConfig'
          ? session.effects.loadConfig(h.context.cwd)
          : session.effects.readSeating(h.registry)).toThrow('retired');
      }
    });

  it.each(['pick', 'rank'] as const)('rejects a %s result from a retired generation', async operation => {
    const h = fixture(); const session = await h.host.open(h.context);
    const seating = session.effects.readSeating(h.registry);
    if (operation === 'pick') {
      h.seating.pick.mockImplementation(() => { h.retire(); return { engineId: 'alpha', reason: 'rated' }; });
      expect(() => seating.pick(['alpha'], ['tribunal'])).toThrow('retired');
    } else {
      h.seating.rank.mockImplementation(ids => { h.retire(); return ids; });
      expect(() => seating.rank(['alpha'])).toThrow('retired');
    }
  });
});
