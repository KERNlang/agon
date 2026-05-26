import { describe, expect, it } from 'vitest';
import { resolveAskInputs } from '../../packages/cli/src/generated/commands/ask.js';

const ACTIVE = ['codex', 'gemini', 'claude'];

describe('resolveAskInputs', () => {
  it('two positionals: first is engine, second is prompt', () => {
    const r = resolveAskInputs('codex', 'fix the bug', [], ACTIVE);
    expect(r).toEqual({ engineId: 'codex', prompt: 'fix the bug', error: null });
  });

  it('one positional: it IS the prompt, engine defaults to first active', () => {
    const r = resolveAskInputs('what is 2+2', undefined, [], ACTIVE);
    expect(r).toEqual({ engineId: 'codex', prompt: 'what is 2+2', error: null });
  });

  it('folds unquoted extra words into the prompt (two-positional form)', () => {
    const r = resolveAskInputs('gemini', 'explain', ['this', 'regex'], ACTIVE);
    expect(r).toEqual({ engineId: 'gemini', prompt: 'explain this regex', error: null });
  });

  it('folds extras into the prompt for the default-engine form', () => {
    const r = resolveAskInputs('explain', undefined, ['this', 'regex'], ACTIVE);
    expect(r).toEqual({ engineId: 'codex', prompt: 'explain this regex', error: null });
  });

  it('reports no-prompt when nothing to ask', () => {
    const r = resolveAskInputs(undefined, undefined, [], ACTIVE);
    expect(r.error).toBe('no-prompt');
  });

  it('reports no-prompt when the engine is named but the prompt is empty', () => {
    const r = resolveAskInputs('codex', '   ', [], ACTIVE);
    expect(r.error).toBe('no-prompt');
  });

  it('reports no-engine when no engines are active (default-engine form)', () => {
    const r = resolveAskInputs('hello there', undefined, [], []);
    expect(r).toEqual({ engineId: '', prompt: 'hello there', error: 'no-engine' });
  });

  it('does not resolve abbreviations itself — leaves engineId verbatim for the registry', () => {
    // `resolveId` lives on the registry; the pure helper passes the token through.
    const r = resolveAskInputs('gem', 'hi', [], ACTIVE);
    expect(r.engineId).toBe('gem');
  });
});
