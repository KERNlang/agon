import assert from 'node:assert/strict';
import {
  DesiredStateConflictError,
  applyDesiredStatePlan,
  assertModManagementAccessibility,
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  createModManagementView,
  parseDesiredState,
  planDesiredStateChange,
  projectRepositoryModSettings,
} from '../../packages/mod-kernel/dist/index.js';

const now = '2026-08-23T20:00:00.000Z';
const catalog = createFirstPartyModCatalog();
const full = createFullCompatDesiredState(catalog, now);

assert.throws(() => parseDesiredState({
  ...full,
  profile: { ...full.profile, definitionHash: `sha256:${'0'.repeat(64)}` },
}), /definitionHash does not match/);

assert.throws(() => planDesiredStateChange(catalog, full, {
  kind: 'apply-profile',
  profile: {
    schemaVersion: 1,
    id: 'broken-child',
    revision: 1,
    selected: ['agon.team-brainstorm'],
    disabled: ['agon.brainstorm'],
    constraints: {},
    settingsDefaults: {},
  },
}, now), (error) => error?.code === 'DISABLED_DEPENDENCY');

const plan = planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.think' }, now);
assert.throws(() => applyDesiredStatePlan({ ...full, revision: 1 }, plan), DesiredStateConflictError);

const disabled = applyDesiredStatePlan(full, plan);
const view = createModManagementView(catalog, disabled);
const think = view.groups.flatMap(({ entries }) => entries).find(({ id }) => id === 'think');
assert.equal(think?.status, 'disabled');
assert.equal(think?.callable, false);
assert.equal(think?.visualStyle, 'greyed');

const brokenView = {
  ...view,
  groups: view.groups.map((group, index) => index === 0
    ? { ...group, entries: group.entries.map((entry, entryIndex) => entryIndex === 0 ? { ...entry, ariaLabel: '' } : entry) }
    : group),
};
assert.throws(() => assertModManagementAccessibility(brokenView), /aria/i);

assert.throws(() => projectRepositoryModSettings({ mods: {}, selected: ['agon.think'] }, full, catalog), /user-global/);
assert.throws(() => createModManagementView({
  ...catalog,
  mods: Object.freeze([...catalog.mods, Object.freeze({
    id: '@kernlang/agon-mod-canary',
    modId: 'agon.canary',
    class: 'user-toggleable-mod-package',
    defaultEnabled: false,
    dependencies: Object.freeze(['@kernlang/agon-mod-api']),
  })]),
}, full), /missing from UI hierarchy/);

console.log('Slice S3 negative controls passed');
