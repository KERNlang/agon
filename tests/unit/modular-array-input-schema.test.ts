import { describe, expect, it } from 'vitest';
import { validateContributionInput } from '../../packages/mod-kernel/src/json-schema-input.js';

describe('contribution array bounds', () => {
  const schema = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 };
  it('accepts values at both inclusive bounds', () => {
    expect(validateContributionInput(schema, ['a'])).toBeNull();
    expect(validateContributionInput(schema, ['a', 'b'])).toBeNull();
  });
  it('rejects values below and above the declared limits', () => {
    expect(validateContributionInput(schema, [])).toContain('too few items');
    expect(validateContributionInput(schema, ['a', 'b', 'c'])).toContain('too many items');
  });
  it.each([-1, 1.5, '1', null])('rejects invalid bound %j instead of ignoring it', bound => {
    expect(validateContributionInput({ ...schema, minItems: bound }, ['a'])).toContain('invalid minItems');
    expect(validateContributionInput({ ...schema, maxItems: bound }, ['a'])).toContain('invalid maxItems');
  });
  it('retains validation of individual items', () => {
    expect(validateContributionInput(schema, [42])).toContain('expected string');
  });
});
