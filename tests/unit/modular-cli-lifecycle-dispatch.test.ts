import { runCommand } from 'citty';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ changed: false, checkedBefore: 0 }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', () => ({
  processSurfacePublicIds: () => new Set(['mod']),
  processSurfaceCatalog: () => [],
  processSurfaceClient: () => ({}),
  assertProcessSurfaceAvailable: () => {
    if (state.changed) throw new Error('restart required');
    state.checkedBefore++;
  },
}));
vi.mock('../../packages/cli/src/commands/mod.js', () => ({
  modCommand: { subCommands: { disable: { run: () => { state.changed = true; } } } },
}));
import { createGeneratedLazySubCommands } from '../../packages/cli/src/lazy-commands.js';

describe('lifecycle command authority timing', () => {
  it('authorizes before a nested mutation and does not reject its successful completion', async () => {
    state.changed = false;
    state.checkedBefore = 0;
    const root = { subCommands: createGeneratedLazySubCommands() };
    await expect(runCommand(root, { rawArgs: ['mod', 'disable'] })).resolves.not.toThrow();
    expect(state.checkedBefore).toBeGreaterThan(0);
    expect(state.changed).toBe(true);
    // Another invocation from the now-stale host must still be rejected.
    await expect(runCommand(root, { rawArgs: ['mod', 'disable'] })).rejects.toThrow('restart required');
  });
});
