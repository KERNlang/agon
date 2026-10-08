import { beforeEach, expect, it, vi } from 'vitest';
import { ensureCesarSession } from '../../packages/cli/src/cesar/session.js';
import { enforceContextBudget } from '../../packages/cli/src/cesar/context-budget.js';
import { markSessionCleanupFailed, sessionCleanupFailed } from '../../packages/cli/src/cesar/session-health.js';

const { create, spine } = vi.hoisted(() => ({ create: vi.fn(), spine: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<object>(), createPersistentSession: create, buildKernContextSpine: spine,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  const original = { engineId: 'old', alive: true, close: vi.fn(), start: vi.fn() };
  const replacement = { engineId: 'fixture', alive: true, start: vi.fn().mockResolvedValue(undefined) };
  create.mockReturnValue(replacement);
  const ctx: any = {
    config: { cesarEngine: 'fixture' }, cesarSession: original,
    registry: { get: () => ({ id: 'fixture', binary: 'fixture' }), findBinary: () => '/fixture/not-executed' },
    chatSession: { messages: [] }, activeEngines: () => [],
  };
  ctx.setCesarSession = vi.fn(value => { ctx.cesarSession = value; });
  return { original, replacement, ctx };
}

beforeEach(() => {
  create.mockReset();
  spine.mockReset().mockResolvedValue('');
});

it.each(['original', 'current', 'healthy'])(
  'checks cleanup after prompt preparation: %s', async target => {
    const { original, replacement, ctx } = fixture();
    const prompt = deferred<string>();
    spine.mockReturnValue(prompt.promise);
    const pending = ensureCesarSession(ctx);
    await vi.waitFor(() => expect(spine).toHaveBeenCalledOnce());
    expect(ctx.cesarSession).toBeNull();
    if (target === 'original') markSessionCleanupFailed(original as any);
    if (target === 'current') {
      ctx.cesarSession = { close: vi.fn() };
      markSessionCleanupFailed(ctx.cesarSession);
    }
    prompt.resolve('');
    if (target === 'healthy') {
      await expect(pending).resolves.toBe(replacement);
      expect(replacement.start).toHaveBeenCalledOnce();
      expect(ctx.cesarSession).toBe(replacement);
    } else {
      await expect(pending).rejects.toThrow('Session cleanup previously failed');
      expect(create).not.toHaveBeenCalled();
      expect(replacement.start).not.toHaveBeenCalled();
    }
  });

it.each(['resolved', 'rejected', 'healthy'])(
  'checks cleanup after a dead-session restart: %s', async outcome => {
    const { original, replacement, ctx } = fixture();
    original.engineId = 'fixture';
    original.alive = false;
    const restart = deferred<void>();
    original.start.mockReturnValue(restart.promise);
    const pending = ensureCesarSession(ctx);
    expect(original.start).toHaveBeenCalledOnce();
    if (outcome !== 'healthy') markSessionCleanupFailed(original as any);
    if (outcome === 'rejected') restart.reject(new Error('fixture restart failure'));
    else restart.resolve();
    if (outcome === 'healthy') {
      await expect(pending).resolves.toBe(replacement);
      expect(replacement.start).toHaveBeenCalledOnce();
    } else {
      await expect(pending).rejects.toThrow('Session cleanup previously failed');
      expect(spine).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    }
  });

it.each(['engine change', 'fingerprint change', 'compaction'])(
  'marks cleanup failed when detachment throws during %s', async path => {
    const { original, ctx } = fixture();
    if (path === 'fingerprint change') original.engineId = 'fixture';
    ctx.setCesarSession.mockImplementation(() => { throw new Error('fixture detach failure'); });
    const pending = path === 'compaction'
      ? enforceContextBudget(ctx, original as any, { id: 'fixture', sessionBudget: { contextWindow: 64 } }, 'cli', vi.fn(), 'prompt')
      : ensureCesarSession(ctx);
    await expect(pending).rejects.toThrow('Session cleanup previously failed');
    expect(original.close).toHaveBeenCalledOnce();
    expect(ctx.setCesarSession).toHaveBeenCalledWith(null);
    expect(sessionCleanupFailed(original as any)).toBe(true);
    expect(ctx.cesarSession).toBe(original);
    expect(create).not.toHaveBeenCalled();
  });
