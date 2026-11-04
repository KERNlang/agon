import { describe, expect, it } from 'vitest';
import {
  DesiredStateError,
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  parseDesiredState,
  planDesiredStateChange,
} from '../../packages/mod-kernel/src/index.js';

const NOW = '2026-08-23T20:00:00.000Z';

describe('full first-party activation matrix', () => {
  it('enables every one of 36 mods with exactly its transitive package closure', () => {
    const catalog = createFirstPartyModCatalog();
    const empty = parseDesiredState({
      schemaVersion: 1, revision: 0, previousHash: null, updatedAt: NOW,
      selected: [], disabled: [], constraints: {}, profile: null,
    });
    expect(catalog.mods).toHaveLength(36);
    for (const mod of catalog.mods) {
      const plan = planDesiredStateChange(catalog, empty, { kind: 'enable', id: mod.modId }, NOW);
      expect(plan.nextState.selected, mod.modId).toEqual([mod.modId]);
      expect(plan.effective, mod.modId).toContain(mod.modId);
      expect(plan.effectivePackages, mod.modId).toContain(mod.id);
      for (const effective of plan.effective) {
        const effectivePackage = catalog.modsById.get(effective)!.id;
        expect(plan.effectivePackages, `${mod.modId} -> ${effective}`).toContain(effectivePackage);
      }
    }
  });

  it('disables every mod from full compatibility with complete reverse closure or refuses no-cascade', () => {
    const catalog = createFirstPartyModCatalog();
    const full = createFullCompatDesiredState(catalog, NOW);
    for (const mod of catalog.mods) {
      const plan = planDesiredStateChange(catalog, full, { kind: 'disable', id: mod.modId }, NOW);
      expect(plan.effective, mod.modId).not.toContain(mod.modId);
      expect(plan.nextState.disabled, mod.modId).toContain(mod.modId);
      for (const cascaded of plan.cascaded) expect(plan.effective, `${mod.modId} cascades ${cascaded}`).not.toContain(cascaded);
      if (plan.cascaded.length) {
        expect(() => planDesiredStateChange(catalog, full, { kind: 'disable', id: mod.modId, noCascade: true }, NOW))
          .toThrowError(expect.objectContaining({ code: 'DEPENDENTS_ACTIVE' }));
      }
    }
  });

  it('applies a named profile rooted at every mod with deterministic dependency expansion', () => {
    const catalog = createFirstPartyModCatalog();
    const full = createFullCompatDesiredState(catalog, NOW);
    for (const mod of catalog.mods) {
      const id = `only-${mod.modId.slice('agon.'.length)}`;
      const plan = planDesiredStateChange(catalog, full, {
        kind: 'apply-profile',
        profile: {
          schemaVersion: 1,
          id,
          revision: 1,
          selected: [mod.modId],
          disabled: [],
          constraints: {},
          settingsDefaults: {},
        },
      }, NOW);
      expect(plan.nextState.profile?.id).toBe(id);
      expect(plan.effective, mod.modId).toContain(mod.modId);
      expect(plan.nextState.profile?.definitionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it('keeps hidden support implicit, excludes unused SaaS support, and exposes immutable maps', () => {
    const catalog = createFirstPartyModCatalog();
    const full = createFullCompatDesiredState(catalog, NOW);
    const plan = planDesiredStateChange(catalog, full, { kind: 'enable', id: 'agon.ask' }, NOW);
    expect(plan.effective).toHaveLength(36);
    expect(plan.effectivePackages).toHaveLength(48);
    expect(plan.effectivePackages).not.toContain('@kernlang/agon-support-saas-api');
    expect((catalog.modsById as Map<string, unknown>).set).toBeUndefined();
    expect((catalog.packagesById as Map<string, unknown>).clear).toBeUndefined();
  });

  it('fails closed for third-party IDs before the S8 trust path exists', () => {
    const catalog = createFirstPartyModCatalog();
    const empty = parseDesiredState({
      schemaVersion: 1, revision: 0, previousHash: null, updatedAt: NOW,
      selected: [], disabled: [], constraints: {}, profile: null,
    });
    expect(() => planDesiredStateChange(catalog, empty, { kind: 'enable', id: 'community.example' }, NOW))
      .toThrowError(expect.objectContaining({ code: 'UNKNOWN_MOD' }));
    expect(() => planDesiredStateChange(catalog, empty, {
      kind: 'apply-profile',
      profile: {
        schemaVersion: 1, id: 'custom', revision: 1,
        selected: ['community.example'], disabled: [], constraints: {}, settingsDefaults: {},
      },
    }, NOW)).toThrow(DesiredStateError);
  });
});
