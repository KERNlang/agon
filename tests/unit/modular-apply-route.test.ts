import { describe, expect, it, vi } from 'vitest';
import type { IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { assertContributionInput } from '../../packages/mod-kernel/src/json-schema-input.js';
import { createMod } from '../../packages/mod-forge/src/implementation.js';

describe('physical Apply route', () => {
  it('validates patch input and requires an interaction, never a competition', async () => {
    let apply!: IntentContribution;
    const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
      if (method === 'intent' && (args[0] as IntentContribution).id === 'intentVariants:0002') apply = args[0] as IntentContribution;
      return () => {};
    } }) as Registrar;
    const dispatch = vi.fn();
    const open = vi.fn(async () => undefined);
    await (await createMod({ engines: { dispatch }, patchApplication: { open } } as unknown as ModServices)).activate(registrar);
    const input = JSON.parse(JSON.stringify(apply.parse('/apply changes.patch --force')));
    expect(() => assertContributionInput(apply.inputSchema, input)).not.toThrow();
    const context = { cwd: '/fixture', invocationId: 'fixture', platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
    await expect(apply.run(input, context)).resolves.toMatchObject({ exitCode: 2 });
    expect(open).toHaveBeenCalledWith(context);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
