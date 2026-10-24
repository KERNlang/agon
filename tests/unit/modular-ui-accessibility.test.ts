import { describe, expect, it } from 'vitest';
import {
  assertModManagementAccessibility,
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  createModManagementView,
} from '../../packages/mod-kernel/src/index.js';

const NOW = '2026-08-23T20:00:00.000Z';

describe('mod management accessibility contract', () => {
  it('provides semantic labels, unique focus order, and non-color-only status for every entry', () => {
    const catalog = createFirstPartyModCatalog();
    const view = createModManagementView(catalog, createFullCompatDesiredState(catalog, NOW));
    expect(() => assertModManagementAccessibility(view)).not.toThrow();
    const entries = view.groups.flatMap(({ entries }) => entries);
    expect(new Set(entries.map(({ keyboardIndex }) => keyboardIndex)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.ariaLabel).toContain(entry.label);
      expect(entry.statusText.length).toBeGreaterThan(0);
    }
  });

  it('has a negative control that fails when semantic metadata is removed', () => {
    const catalog = createFirstPartyModCatalog();
    const view = createModManagementView(catalog, createFullCompatDesiredState(catalog, NOW));
    const first = view.groups[0]!.entries[0]!;
    const broken = {
      ...view,
      groups: [{ ...view.groups[0]!, entries: [{ ...first, ariaLabel: '' }, ...view.groups[0]!.entries.slice(1)] }, ...view.groups.slice(1)],
    };
    expect(() => assertModManagementAccessibility(broken)).toThrow(/aria/i);
  });
});
