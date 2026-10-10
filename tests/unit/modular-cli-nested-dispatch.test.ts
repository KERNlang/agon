import { runCommand } from 'citty';
import type { CommandDef } from 'citty';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [] as string[], disabled: new Set<string>(), failure: false, generation: 0 }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', () => {
  const entries = ['ratings', 'ratings purge-unknown'].map(publicId => ({ publicId, category: 'cliCommands', description: publicId, aliases: publicId === 'ratings' ? ['scores'] : [] }));
  const check = (_surface: string, id: string) => { if (state.disabled.has(id)) throw new Error(`disabled: ${id}`); };
  return {
    processSurfacePublicIds: () => new Set(entries.map(entry => entry.publicId)),
    processSurfaceCatalog: () => entries,
    captureProcessSurfaceAuthority: () => {
      const generation = state.generation;
      return () => { if (generation !== state.generation) throw new Error('stale generation'); };
    },
    assertProcessSurfaceAvailable: check,
    processSurfaceClient: () => ({ assertAvailable(id: string) {
      check('cli', id);
      return { owner: { id: 'agon.ratings' }, payload: {
        inputSchema: { type: 'object', additionalProperties: false, properties: {} }, cli: {},
        run() { state.calls.push(id); if (state.failure) throw new Error('child failed'); return { exitCode: 0 }; },
      } };
    } }),
  };
});
import { createGeneratedLazySubCommands } from '../../packages/cli/src/lazy-commands.js';

beforeEach(() => { state.calls = []; state.disabled.clear(); state.failure = false; state.generation = 0; });
it('keeps the parent action for an empty positional argument, matching Citty', async () => {
  await runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: ['ratings', ''] });
  expect(state.calls).toEqual(['ratings']);
});
it('rejects a stale cached generation before any nested contribution runs', async () => {
  const root = { subCommands: createGeneratedLazySubCommands() };
  state.generation++;
  await expect(runCommand(root, { rawArgs: ['ratings', 'purge-unknown'] })).rejects.toThrow('stale generation');
  expect(state.calls).toEqual([]);
});
it('runs the parent action when no child was selected', async () => {
  await runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: ['ratings'] });
  expect(state.calls).toEqual(['ratings']);
});
it.each(['enabled', 'disabled', 'stale'])('preserves direct run authority when %s', async mode => {
  const command = createGeneratedLazySubCommands().ratings as CommandDef;
  if (mode === 'disabled') state.disabled.add('ratings');
  if (mode === 'stale') state.generation++;
  const pending = command.run!({ args: {} } as never);
  if (mode === 'enabled') { await pending; expect(state.calls).toEqual(['ratings']); }
  else { await expect(pending).rejects.toThrow(); expect(state.calls).toEqual([]); }
});
it.each(['ratings', 'scores'])('runs only the selected child through %s', async name => {
  await runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: [name, 'purge-unknown'] });
  expect(state.calls).toEqual(['ratings purge-unknown']);
});
it.each(['ratings', 'ratings purge-unknown'])('rejects cached disabled %s before any effect', async disabled => {
  const root = { subCommands: createGeneratedLazySubCommands() };
  state.disabled.add(disabled);
  await expect(runCommand(root, { rawArgs: ['ratings', 'purge-unknown'] })).rejects.toThrow('disabled');
  expect(state.calls).toEqual([]);
});
it('rejects unknown children without running the parent', async () => {
  await expect(runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: ['ratings', 'unknown'] })).rejects.toThrow('Unknown command');
  expect(state.calls).toEqual([]);
});
it('preserves child failure without running the parent', async () => {
  state.failure = true;
  await expect(runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: ['ratings', 'purge-unknown'] })).rejects.toThrow('child failed');
  expect(state.calls).toEqual(['ratings purge-unknown']);
});
