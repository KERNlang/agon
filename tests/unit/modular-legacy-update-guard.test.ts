import { describe, expect, it } from 'vitest';
import { assertLegacyUpdaterAllowed } from '../../packages/cli/src/commands/update.js';

describe('legacy updater modular guard', () => {
  it('makes global self-overwrite unreachable from a managed invocation', () => {
    expect(() => assertLegacyUpdaterAllowed({ AGON_MANAGED_INSTALLATION_ID: 'qualified-prefix' }))
      .toThrow('legacy global self-update is disabled');
  });

  it('retains the explicit compatibility path only for pre-modular installations', () => {
    expect(() => assertLegacyUpdaterAllowed({})).not.toThrow();
  });
});
