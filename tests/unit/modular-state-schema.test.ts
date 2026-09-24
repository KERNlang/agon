import { describe, expect, it } from 'vitest';
import { validateDesiredState, validateProfileDefinition } from '../../packages/mod-api/src/index.js';
import { createFirstPartyModCatalog, createFullCompatDesiredState } from '../../packages/mod-kernel/src/index.js';

describe('public desired-state and profile schemas', () => {
  it('accepts the kernel full-compat document and returns an immutable value', () => {
    const state = createFullCompatDesiredState(createFirstPartyModCatalog(), '2026-08-23T20:00:00.000Z');
    const parsed = validateDesiredState(JSON.parse(JSON.stringify(state)));
    expect(parsed).toEqual(state);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.selected)).toBe(true);
  });

  it('rejects unsorted, overlapping, secret-bearing, or non-semver profile data', () => {
    const base = {
      schemaVersion: 1 as const,
      id: 'reviewer', revision: 1,
      selected: ['agon.review', 'agon.think'], disabled: ['agon.forge'],
      constraints: { 'agon.review': '^1.0.0' }, settingsDefaults: {},
    };
    expect(validateProfileDefinition(base).id).toBe('reviewer');
    expect(() => validateProfileDefinition({ ...base, selected: [...base.selected].reverse() })).toThrow(/ASCII-sorted/);
    expect(() => validateProfileDefinition({ ...base, disabled: ['agon.review'] })).toThrow(/disjoint/);
    expect(() => validateProfileDefinition({ ...base, constraints: { 'agon.review': 'latest' } })).toThrow(/semver/);
    expect(() => validateProfileDefinition({ ...base, trust: { allow: true } })).toThrow();
  });
});
