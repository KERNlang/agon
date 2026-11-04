import { describe, expect, it } from 'vitest';
import {
  applyDesiredStatePlan,
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  createModManagementView,
  planDesiredStateChange,
  reduceModManagementFocus,
  renderModManagementText,
} from '../../packages/mod-kernel/src/index.js';

const NOW = '2026-08-23T20:00:00.000Z';
const pkg = (id: string): string => `agon.${id}`;

describe('dependency-aware grouped mod UI', () => {
  it('projects every first-party mod exactly once, including Campfire, plus non-toggleable kernel management', () => {
    const catalog = createFirstPartyModCatalog();
    const view = createModManagementView(catalog, createFullCompatDesiredState(catalog, NOW));
    const modEntries = view.groups.flatMap((group) => group.entries).filter((entry) => entry.kind === 'mod');
    expect(modEntries).toHaveLength(36);
    expect(new Set(modEntries.map(({ packageId }) => packageId)).size).toBe(36);
    expect(modEntries.some(({ id }) => id === 'campfire')).toBe(true);
    expect(view.groups.find(({ id }) => id === 'manage')?.entries.every(({ toggleable }) => !toggleable)).toBe(true);
  });

  it('nests child workflows under parents and keeps disabled entries visible but non-callable', () => {
    const catalog = createFirstPartyModCatalog();
    const full = createFullCompatDesiredState(catalog, NOW);
    const state = applyDesiredStatePlan(full, planDesiredStateChange(catalog, full, { kind: 'disable', id: pkg('brainstorm') }, NOW));
    const view = createModManagementView(catalog, state);
    const create = view.groups.find(({ id }) => id === 'create')!;
    const brainstorm = create.entries.find(({ id }) => id === 'brainstorm')!;
    const team = create.entries.find(({ id }) => id === 'team-brainstorm')!;
    expect(brainstorm.status).toBe('disabled');
    expect(brainstorm.callable).toBe(false);
    expect(brainstorm.visualStyle).toBe('greyed');
    expect(team.parentId).toBe('brainstorm');
    expect(team.depth).toBe(1);
    expect(team.statusText).toMatch(/Disabled/);
  });

  it('shows typed blocked reasons and recovery in text without relying on color', () => {
    const catalog = createFirstPartyModCatalog();
    const view = createModManagementView(catalog, createFullCompatDesiredState(catalog, NOW), {
      availability: {
        [pkg('review')]: {
          code: 'active-resource',
          message: 'A review session is still running.',
          recovery: 'Stop the session or schedule the change for restart.',
        },
      },
    });
    const review = view.groups.flatMap(({ entries }) => entries).find(({ id }) => id === 'review')!;
    expect(review.status).toBe('blocked');
    expect(review.statusText).toContain('Blocked: active resource');
    expect(review.recovery).toContain('Stop the session');
    const text = renderModManagementText(view);
    expect(text).toContain('[blocked: active resource] Review');
    expect(text).toContain('Recovery: Stop the session');
  });

  it('supports deterministic keyboard navigation across responsive flattened entries', () => {
    const catalog = createFirstPartyModCatalog();
    const view = createModManagementView(catalog, createFullCompatDesiredState(catalog, NOW));
    const focusable = view.groups.flatMap(({ entries }) => entries).filter(({ focusable }) => focusable);
    expect(reduceModManagementFocus(view, focusable[0]!.id, 'End')).toBe(focusable.at(-1)!.id);
    expect(reduceModManagementFocus(view, focusable.at(-1)!.id, 'ArrowDown')).toBe(focusable[0]!.id);
    expect(reduceModManagementFocus(view, focusable[0]!.id, 'ArrowUp')).toBe(focusable.at(-1)!.id);
    expect(reduceModManagementFocus(view, focusable[4]!.id, 'Home')).toBe(focusable[0]!.id);
  });
});
