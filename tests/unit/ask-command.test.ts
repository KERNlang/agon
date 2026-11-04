import { describe, expect, it } from 'vitest';
import { resolveAskInputs } from '../../packages/cli/src/commands/ask.js';
import { createMod } from '../../packages/mod-ask/src/implementation.js';
import type { CommandContribution, InvocationContext, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

const ACTIVE = ['codex', 'gemini', 'claude'];

async function runPhysicalAsk(result: Record<string, Json>) {
  let command!: CommandContribution;
  const mod = await createMod({
    engines: { dispatch: async () => result },
    receipts: { record: async () => 'fixture-receipt' },
  } as unknown as ModServices);
  const dispose = await mod.activate({ command: (_surface, contribution) => {
    command = contribution;
    return () => {};
  } } as Registrar);
  const context: InvocationContext = { invocationId: 'ask-diagnostics', cwd: '/fixture',
    platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
  try {
    return await command.run({ engine: 'fixture', prompt: 'Question', timeout: '7' }, context);
  } finally { await dispose(); }
}

describe('physical Ask failure diagnostics', () => {
  it.each([false, true])('retains bounded provider detail (timeout: %s)', async timedOut => {
    const detail = 'x'.repeat(501);
    const result = await runPhysicalAsk({ engineId: 'fixture', exitCode: 2, stdout: '',
      stderr: `  ${detail}  `, timedOut });
    expect(result).toEqual({ exitCode: 1, stderr: `${timedOut
      ? 'fixture timed out after 7s' : 'fixture exited 2 with no answer'}\n${'x'.repeat(500)}\n` });
  });

  it.each([null, 42, '', '   '])('keeps the summary without invalid or blank detail: %j', async stderr => {
    expect(await runPhysicalAsk({ engineId: 'fixture', exitCode: 2, stdout: '', stderr }))
      .toEqual({ exitCode: 1, stderr: 'fixture exited 2 with no answer\n' });
  });

  it('trims both ends of a short provider diagnostic', async () => {
    expect(await runPhysicalAsk({ engineId: 'fixture', exitCode: 2, stdout: '', stderr: '  diagnostic  ' }))
      .toEqual({ exitCode: 1, stderr: 'fixture exited 2 with no answer\ndiagnostic\n' });
  });

  it('keeps successful output free of provider diagnostics', async () => {
    expect(await runPhysicalAsk({ engineId: 'fixture', exitCode: 0, stdout: '  Answer  ', stderr: 'provider notice' }))
      .toEqual({ exitCode: 0, stdout: 'Answer\n' });
  });
});

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
