import { describe, expect, it } from 'vitest';
import {
  assertModManagementAccessibility,
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  createModManagementView,
  reduceModManagementFocus,
  renderModManagementText,
} from '../../packages/mod-kernel/src/index.js';

const NOW = '2026-09-03T00:00:00.000Z';

describe('S8 third-party mod management UI', () => {
  it('keeps local mods visible with explicit source, trust, permission, and recovery text', () => {
    const catalog = createFirstPartyModCatalog();
    const view = createModManagementView(catalog, createFullCompatDesiredState(catalog, NOW), {
      externalMods: [
        {
          id: 'example.blocked', packageId: 'example.blocked', label: 'Blocked Example',
          source: 'user-folder', enabled: true, trustSummary: 'Full-code trust not granted',
          permissionSummary: 'network.fetch: not granted',
          reason: { code: 'untrusted-source', message: 'Exact package bytes are not trusted.', recovery: 'Inspect the package, then approve its exact content hash.' },
        },
        {
          id: 'example.disabled', packageId: 'example.disabled', label: 'Disabled Example',
          source: 'explicit-dev', enabled: false, trustSummary: 'Full-code trust granted for this path',
          permissionSummary: 'state.read: granted',
        },
      ],
    });
    const community = view.groups.find(({ id }) => id === 'community');
    expect(community?.entries.map(({ id }) => id)).toEqual(['example.blocked', 'example.disabled']);
    expect(community?.entries[0]).toMatchObject({ status: 'blocked', callable: false, visualStyle: 'blocked' });
    expect(community?.entries[1]).toMatchObject({ status: 'disabled', callable: false, visualStyle: 'greyed' });
    const output = renderModManagementText(view);
    expect(output).toContain('Local and community mods');
    expect(output).toContain('Source: user-folder');
    expect(output).toContain('Trust: Full-code trust not granted');
    expect(output).toContain('Permissions: network.fetch: not granted');
    expect(output).toContain('Recovery: Inspect the package, then approve its exact content hash.');
    assertModManagementAccessibility(view);
    expect(reduceModManagementFocus(view, 'example.blocked', 'ArrowDown')).toBe('example.disabled');
  });

  it('refuses an external mod that collides with a first-party identity', () => {
    const catalog = createFirstPartyModCatalog();
    expect(() => createModManagementView(catalog, createFullCompatDesiredState(catalog, NOW), {
      externalMods: [{ id: 'agon.think', packageId: 'evil', label: 'Collision', source: 'user-folder', enabled: true, trustSummary: 'trusted', permissionSummary: 'none' }],
    })).toThrow(/duplicate external mod/);
  });
});
