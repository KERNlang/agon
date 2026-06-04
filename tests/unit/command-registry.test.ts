import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../../packages/core/src/command-registry.js';
import { registerBuiltinCommands } from '../../packages/core/src/builtin-commands.js';

describe('CommandRegistry', () => {
  it('registers and retrieves a command', () => {
    const reg = new CommandRegistry();
    reg.register({
      definition: { name: 'test', description: 'a test', category: 'test' },
      parseArgs: (rest: string) => ({ input: rest }),
      execute: async () => ({ handled: true, ranAsJob: false }),
    });
    expect(reg.has('test')).toBe(true);
    expect(reg.get('test')?.definition.name).toBe('test');
  });

  it('resolves aliases', () => {
    const reg = new CommandRegistry();
    reg.register({
      definition: { name: 'workspace', description: 'manage workspaces', category: 'config', aliases: ['ws'] },
      parseArgs: (rest: string) => ({ input: rest }),
      execute: async () => ({ handled: true, ranAsJob: false }),
    });
    expect(reg.has('ws')).toBe(true);
    expect(reg.get('ws')?.definition.name).toBe('workspace');
  });

  it('case-insensitive lookup', () => {
    const reg = new CommandRegistry();
    reg.register({
      definition: { name: 'Forge', description: 'forge', category: 'competition' },
      parseArgs: (rest: string) => ({ input: rest }),
      execute: async () => ({ handled: true, ranAsJob: false }),
    });
    expect(reg.has('forge')).toBe(true);
    expect(reg.has('FORGE')).toBe(true);
  });

  it('listForHelp produces { cmd, desc } with / prefix', () => {
    const reg = new CommandRegistry();
    reg.register({
      definition: { name: 'test', description: 'a test command', category: 'test' },
      parseArgs: (rest: string) => ({ input: rest }),
      execute: async () => ({ handled: true, ranAsJob: false }),
    });
    const list = reg.listForHelp();
    expect(list).toHaveLength(1);
    expect(list[0].cmd).toBe('/test');
    expect(list[0].desc).toBe('a test command');
  });

  it('unregisters command and aliases', () => {
    const reg = new CommandRegistry();
    reg.register({
      definition: { name: 'foo', description: 'foo', category: 'test', aliases: ['f'] },
      parseArgs: (rest: string) => ({ input: rest }),
      execute: async () => ({ handled: true, ranAsJob: false }),
    });
    expect(reg.has('foo')).toBe(true);
    expect(reg.has('f')).toBe(true);
    reg.unregister('foo');
    expect(reg.has('foo')).toBe(false);
    expect(reg.has('f')).toBe(false);
  });

  it('duplicate registration overwrites', () => {
    const reg = new CommandRegistry();
    reg.register({
      definition: { name: 'test', description: 'v1', category: 'test' },
      parseArgs: (rest: string) => ({ input: rest }),
      execute: async () => ({ handled: true, ranAsJob: false }),
    });
    reg.register({
      definition: { name: 'test', description: 'v2', category: 'test' },
      parseArgs: (rest: string) => ({ input: rest }),
      execute: async () => ({ handled: true, ranAsJob: false }),
    });
    expect(reg.get('test')?.definition.description).toBe('v2');
  });

  it('list returns definitions sorted by category then name', () => {
    const reg = new CommandRegistry();
    reg.register({ definition: { name: 'b', description: '', category: 'z' }, parseArgs: () => ({}), execute: async () => ({ handled: true, ranAsJob: false }) });
    reg.register({ definition: { name: 'a', description: '', category: 'z' }, parseArgs: () => ({}), execute: async () => ({ handled: true, ranAsJob: false }) });
    reg.register({ definition: { name: 'c', description: '', category: 'a' }, parseArgs: () => ({}), execute: async () => ({ handled: true, ranAsJob: false }) });
    const defs = reg.list();
    expect(defs[0].name).toBe('c'); // category 'a' first
    expect(defs[1].name).toBe('a'); // then 'z', alphabetical
    expect(defs[2].name).toBe('b');
  });

  it('names returns all registered names', () => {
    const reg = new CommandRegistry();
    reg.register({ definition: { name: 'x', description: '', category: 'test' }, parseArgs: () => ({}), execute: async () => ({ handled: true, ranAsJob: false }) });
    reg.register({ definition: { name: 'y', description: '', category: 'test' }, parseArgs: () => ({}), execute: async () => ({ handled: true, ranAsJob: false }) });
    expect(reg.names()).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('registers autonomous agent commands in builtin metadata', () => {
    const reg = new CommandRegistry();
    registerBuiltinCommands(reg);

    expect(reg.has('agent')).toBe(true);
    expect(reg.has('agent-solo')).toBe(true);
    expect(reg.has('team-agent')).toBe(true);
    expect(reg.has('speculate')).toBe(true);
    expect(reg.has('auto')).toBe(true);
    expect(reg.has('autonomous')).toBe(true);
    expect(reg.has('compact')).toBe(true);
  });
});
