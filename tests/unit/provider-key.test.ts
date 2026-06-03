import { describe, it, expect } from 'vitest';
import { parseProviderKeyArgs } from '../../packages/cli/src/handlers/provider.js';

// Pure parser behind `/provider key …` (REPL) and the `agon provider key …` CLI.
// Keys are stored by env-var name in ~/.agon/auth.json and shared across every
// engine pointing at that env var, so `set` changes the key for all of them.
describe('parseProviderKeyArgs', () => {
  it('empty / "list" → list', () => {
    expect(parseProviderKeyArgs('')).toEqual({ sub: 'list' });
    expect(parseProviderKeyArgs('   ')).toEqual({ sub: 'list' });
    expect(parseProviderKeyArgs('list')).toEqual({ sub: 'list' });
  });

  it('set with env + value', () => {
    expect(parseProviderKeyArgs('set MINIMAX_API_KEY sk-abc123')).toEqual({
      sub: 'set',
      envVar: 'MINIMAX_API_KEY',
      value: 'sk-abc123',
    });
  });

  it('set with no value → value undefined (caller errors / prompts)', () => {
    expect(parseProviderKeyArgs('set MINIMAX_API_KEY')).toEqual({
      sub: 'set',
      envVar: 'MINIMAX_API_KEY',
      value: undefined,
    });
  });

  it('set preserves multi-token values (keys never contain spaces, but be safe)', () => {
    expect(parseProviderKeyArgs('set X_KEY a b c')).toEqual({
      sub: 'set',
      envVar: 'X_KEY',
      value: 'a b c',
    });
  });

  it('clear / remove / rm all → clear', () => {
    expect(parseProviderKeyArgs('clear MINIMAX_API_KEY')).toEqual({ sub: 'clear', envVar: 'MINIMAX_API_KEY' });
    expect(parseProviderKeyArgs('remove MINIMAX_API_KEY')).toEqual({ sub: 'clear', envVar: 'MINIMAX_API_KEY' });
    expect(parseProviderKeyArgs('rm MINIMAX_API_KEY')).toEqual({ sub: 'clear', envVar: 'MINIMAX_API_KEY' });
  });

  it('case-insensitive subcommand', () => {
    expect(parseProviderKeyArgs('SET FOO bar')).toEqual({ sub: 'set', envVar: 'FOO', value: 'bar' });
    expect(parseProviderKeyArgs('Clear FOO')).toEqual({ sub: 'clear', envVar: 'FOO' });
  });

  it('unknown subcommand → help', () => {
    expect(parseProviderKeyArgs('frobnicate FOO')).toEqual({ sub: 'help' });
  });

  it('tolerates extra whitespace between tokens', () => {
    expect(parseProviderKeyArgs('  set   FOO   bar  ')).toEqual({ sub: 'set', envVar: 'FOO', value: 'bar' });
  });
});
