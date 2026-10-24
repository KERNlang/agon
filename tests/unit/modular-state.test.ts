import { describe, expect, it } from 'vitest';
import {
  DesiredStateConflictError,
  applyDesiredStatePlan,
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  parseDesiredState,
  parseProfileDefinition,
  planDesiredStateChange,
  projectRepositoryModSettings,
  sha256Canonical,
} from '../../packages/mod-kernel/src/index.js';

const NOW = '2026-08-23T20:00:00.000Z';
const pkg = (id: string): string => `agon.${id}`;

describe('Modular Agon desired state and profiles', () => {
  it('builds a full-compatible explicit state for all 36 first-party mods', () => {
    const catalog = createFirstPartyModCatalog();
    const state = createFullCompatDesiredState(catalog, NOW);
    expect(state.selected).toHaveLength(36);
    expect(state.disabled).toEqual([]);
    expect(state.profile?.id).toBe('full-compat');
    expect(state.profile?.selected).toEqual(state.selected);
    expect(new Set(state.selected).size).toBe(36);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('parses strict canonical desired state and profile documents', () => {
    const catalog = createFirstPartyModCatalog();
    const state = createFullCompatDesiredState(catalog, NOW);
    expect(parseDesiredState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(() => parseDesiredState({ ...state, surprise: true })).toThrow(/unknown or missing fields/);
    expect(() => parseDesiredState({ ...state, selected: [state.selected[0], state.selected[0]] })).toThrow(/unique/);
    expect(() => parseDesiredState({ ...state, selected: [...state.selected].reverse() })).toThrow(/ASCII-sorted/);
    expect(() => parseDesiredState({ ...state, disabled: [state.selected[0]] })).toThrow(/selected and disabled/);
    expect(() => parseDesiredState({
      ...state,
      profile: { ...state.profile!, definitionHash: 'sha256:' + '0'.repeat(64) },
    })).toThrow(/definitionHash does not match/);

    const profile = parseProfileDefinition({
      schemaVersion: 1,
      id: 'reviewer',
      revision: 1,
      selected: [pkg('review'), pkg('think')],
      disabled: [pkg('forge')],
      constraints: { [pkg('review')]: '^1.0.0' },
      settingsDefaults: { [pkg('review')]: { strict: true } },
    });
    expect(profile.selected).toEqual([pkg('review'), pkg('think')]);
    expect(() => parseProfileDefinition({ ...profile, trust: {} })).toThrow(/unknown or missing fields/);
    expect(() => parseProfileDefinition({ ...profile, constraints: { [pkg('review')]: 'not-semver' } })).toThrow(/semver/);
  });

  it('snapshots profile expansion so later definition changes never alter an existing state', () => {
    const catalog = createFirstPartyModCatalog();
    const current = createFullCompatDesiredState(catalog, NOW);
    const reviewerV1 = parseProfileDefinition({
      schemaVersion: 1, id: 'reviewer', revision: 1,
      selected: [pkg('review'), pkg('think')], disabled: [], constraints: {}, settingsDefaults: {},
    });
    const firstPlan = planDesiredStateChange(catalog, current, { kind: 'apply-profile', profile: reviewerV1 }, NOW);
    const applied = applyDesiredStatePlan(current, firstPlan);
    const before = sha256Canonical(applied);
    const reviewerV2 = parseProfileDefinition({
      schemaVersion: 1, id: 'reviewer', revision: 2,
      selected: [pkg('review'), pkg('think'), pkg('tribunal')], disabled: [], constraints: {}, settingsDefaults: {},
    });
    expect(reviewerV2.revision).toBe(2);
    expect(sha256Canonical(applied)).toBe(before);
    expect(applied.profile?.selected).toEqual([pkg('review'), pkg('think')]);
    expect(applied.profile?.definitionHash).not.toBe(sha256Canonical(reviewerV2));
  });

  it('enables dependency closure but never enables dependent children', () => {
    const catalog = createFirstPartyModCatalog();
    const empty = parseDesiredState({
      schemaVersion: 1, revision: 0, previousHash: null, updatedAt: NOW,
      selected: [], disabled: [], constraints: {}, profile: null,
    });
    const child = planDesiredStateChange(catalog, empty, { kind: 'enable', id: pkg('team-brainstorm') }, NOW);
    expect(child.nextState.selected).toEqual([pkg('team-brainstorm')]);
    expect(child.autoEnabled).toContain(pkg('brainstorm'));
    expect(child.effective).toContain(pkg('brainstorm'));
    expect(child.effective).toContain(pkg('team-brainstorm'));

    const parent = planDesiredStateChange(catalog, empty, { kind: 'enable', id: pkg('brainstorm') }, NOW);
    expect(parent.effective).toContain(pkg('brainstorm'));
    expect(parent.effective).not.toContain(pkg('team-brainstorm'));
  });

  it('previews reverse cascades and refuses --no-cascade without mutating state', () => {
    const catalog = createFirstPartyModCatalog();
    const current = parseDesiredState({
      schemaVersion: 1, revision: 2, previousHash: null, updatedAt: NOW,
      selected: [pkg('brainstorm'), pkg('pipeline-orchestration'), pkg('team-brainstorm')].sort(),
      disabled: [], constraints: {}, profile: null,
    });
    expect(() => planDesiredStateChange(catalog, current, { kind: 'disable', id: pkg('brainstorm'), noCascade: true }, NOW))
      .toThrowError(expect.objectContaining({ code: 'DEPENDENTS_ACTIVE' }));
    expect(current.selected).toContain(pkg('brainstorm'));

    const plan = planDesiredStateChange(catalog, current, { kind: 'disable', id: pkg('brainstorm') }, NOW);
    expect(plan.cascaded).toEqual([pkg('pipeline-orchestration'), pkg('team-brainstorm')]);
    expect(plan.nextState.selected).toEqual([]);
    expect(plan.nextState.disabled).toContain(pkg('brainstorm'));
  });

  it('rejects stale plans and is permutation invariant', () => {
    const catalog = createFirstPartyModCatalog();
    const current = createFullCompatDesiredState(catalog, NOW);
    const plan = planDesiredStateChange(catalog, current, { kind: 'disable', id: pkg('think') }, NOW);
    const concurrent = parseDesiredState({ ...current, revision: current.revision + 1, updatedAt: '2026-08-23T20:00:01.000Z' });
    expect(() => applyDesiredStatePlan(concurrent, plan)).toThrow(DesiredStateConflictError);

    const shuffled = createFirstPartyModCatalog([...catalog.packages].reverse());
    const other = planDesiredStateChange(shuffled, current, { kind: 'disable', id: pkg('think') }, NOW);
    expect(other.nextState).toEqual(plan.nextState);
    expect(other.effective).toEqual(plan.effective);
  });

  it('keeps repository configuration settings-only and retains disabled namespaces without applying them', () => {
    const catalog = createFirstPartyModCatalog();
    const current = applyDesiredStatePlan(
      createFullCompatDesiredState(catalog, NOW),
      planDesiredStateChange(catalog, createFullCompatDesiredState(catalog, NOW), { kind: 'disable', id: pkg('forge') }, NOW),
    );
    const projection = projectRepositoryModSettings({
      mods: {
        [pkg('think')]: { steps: 12 },
        [pkg('forge')]: { engines: ['codex'] },
        'community.unknown': { preserved: true },
      },
    }, current, catalog);
    expect(projection.applied).toEqual({ [pkg('think')]: { steps: 12 } });
    expect(projection.retained).toEqual({
      [pkg('forge')]: { engines: ['codex'] },
      'community.unknown': { preserved: true },
    });
    for (const forbidden of ['profile', 'selected', 'disabled', 'install', 'trust', 'grants']) {
      expect(() => projectRepositoryModSettings({ mods: {}, [forbidden]: [] }, current, catalog)).toThrow(/user-global/);
    }
  });
});
