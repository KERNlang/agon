import { describe, expect, it } from 'vitest';
import { createReleaseSetupSelection } from './release-setup.js';

const now = '2026-08-23T00:00:00.000Z';

describe('release setup selection', () => {
  it('keeps full compatibility as the default complete profile', () => {
    const selected = createReleaseSetupSelection({ profile: 'full-compat', now });
    expect(selected.effectiveModIds).toHaveLength(36);
    expect(selected.effectivePackageIds).toHaveLength(48);
    expect(selected.effectiveModIds).toContain('agon.think');
  });

  it('turns a small profile into its exact dependency closure', () => {
    const selected = createReleaseSetupSelection({ profile: 'minimal', with: ['review'], now });
    expect(selected.desiredState.selected).toEqual(['agon.ask', 'agon.review']);
    expect(selected.effectiveModIds).toEqual(['agon.ask', 'agon.review']);
    expect(selected.effectivePackageIds).toContain('@kernlang/agon-support-verification');
    expect(selected.effectivePackageIds).not.toContain('@kernlang/agon-mod-forge');
  });

  it('cascades exclusion through hard dependents', () => {
    const selected = createReleaseSetupSelection({ profile: 'maker', without: ['forge'], now });
    expect(selected.effectiveModIds).not.toContain('agon.forge');
    expect(selected.effectiveModIds).not.toContain('agon.team-forge');
    expect(selected.desiredState.disabled).toContain('agon.team-forge');
  });

  it('rejects ambiguous include/exclude and unknown IDs', () => {
    expect(() => createReleaseSetupSelection({ profile: 'custom', with: ['think'], without: ['agon.think'], now })).toThrow(/both included and excluded/);
    expect(() => createReleaseSetupSelection({ profile: 'custom', with: ['missing'], now })).toThrow(/unknown first-party mod/);
  });
});
