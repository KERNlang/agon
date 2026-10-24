import { beforeEach, expect, it, vi } from 'vitest';
import { ensureCesarSession } from '../../packages/cli/src/cesar/session.js';
import { enforceContextBudget } from '../../packages/cli/src/cesar/context-budget.js';
import { markSessionCleanupFailed, sessionCleanupFailed } from '../../packages/cli/src/cesar/session-health.js';
import { beginCesarTurn, createCesarTurnRuntimeHost } from '../../packages/cli/src/cesar/turn-runtime.js';
import { handleCesarBrain } from '../../packages/cli/src/cesar/brain.js';
import { startChatSession } from '@kernlang/agon-core';

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
  const replacement = { engineId: 'fixture', alive: true, close: vi.fn(), start: vi.fn().mockResolvedValue(undefined) };
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

it.each(['healthy', 'disabled', 'superseded', 'cancelled'])('checks fresh startup before publishing its candidate (%s)', async change => {
  const { replacement, ctx } = fixture();
  const host = createCesarTurnRuntimeHost('startup-owner');
  ctx.cesarRuntimeHost = host;
  const controller = new AbortController();
  ctx.cesar = { abortSignal: controller.signal };
  let disabled = false;
  beginCesarTurn(host, 'first', 'fixture', undefined, () => {
    if (disabled) throw new Error('Owner disabled');
  });
  const started = deferred<void>();
  replacement.start.mockReturnValue(started.promise);
  const pending = ensureCesarSession(ctx);
  const settled = pending.then(value => ({ value }), error => ({ error }));
  await vi.waitFor(() => expect(replacement.start).toHaveBeenCalledOnce());
  const successor = { engineId: 'successor', alive: true, close: vi.fn() };
  if (change === 'disabled') disabled = true;
  if (change === 'cancelled') controller.abort();
  if (change === 'superseded') {
    beginCesarTurn(host, 'second', 'fixture');
    ctx.cesarSession = successor;
  }
  started.resolve();
  const result = await settled;
  if (change === 'healthy') {
    expect(result).toEqual({ value: replacement });
    expect(ctx.cesarSession).toBe(replacement);
    expect(replacement.close).not.toHaveBeenCalled();
  } else {
    expect(result).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining('DENIED') }) });
    expect(replacement.close).toHaveBeenCalledOnce();
    expect(ctx.setCesarSession).not.toHaveBeenCalledWith(replacement);
    expect(ctx.cesarSession).toBe(change === 'superseded' ? successor : null);
    expect(successor.close).not.toHaveBeenCalled();
  }
});

it('does not launch fallback after actual acquisition is superseded', async () => {
  const { ctx, replacement } = fixture();
  ctx.chatSession = startChatSession();
  ctx.activeEngines = () => ['fixture'];
  ctx.setActiveAbort = vi.fn();
  ctx.adapter = { dispatch: vi.fn().mockResolvedValue({ stdout: 'must not run', stderr: '' }) };
  const prompt = deferred<string>();
  spine.mockReturnValue(prompt.promise);
  const pending = handleCesarBrain('fixture', vi.fn(), ctx);
  const settled = pending.then(value => ({ value }), error => ({ error }));
  await Promise.race([
    vi.waitFor(() => expect(spine).toHaveBeenCalledOnce()),
    settled.then(result => { throw new Error(`Brain ended before acquisition: ${'error' in result ? String(result.error) : JSON.stringify(result.value)}`); }),
  ]);
  beginCesarTurn(ctx.cesarRuntimeHost, 'replacement', 'fixture');
  ctx.cesar.turnId = 'replacement';
  prompt.resolve('');
  const result = await settled;
  expect(ctx.adapter.dispatch).not.toHaveBeenCalled();
  expect(replacement.start).not.toHaveBeenCalled();
  expect(result).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining('DENIED') }) });
  expect(ctx.cesar.turnId).toBe('replacement');
});

it.each([false, true])('keeps failed candidate cleanup blocked without replacing a successor (%s)', async hasSuccessor => {
  const { ctx, replacement } = fixture();
  const host = createCesarTurnRuntimeHost('candidate-cleanup');
  ctx.cesarRuntimeHost = host;
  beginCesarTurn(host, 'first', 'fixture');
  const started = deferred<void>();
  replacement.start.mockReturnValue(started.promise);
  replacement.close.mockImplementation(() => { throw new Error('fixture close failed'); });
  const pending = ensureCesarSession(ctx);
  const settled = pending.then(value => ({ value }), error => ({ error }));
  await vi.waitFor(() => expect(replacement.start).toHaveBeenCalledOnce());
  beginCesarTurn(host, 'replacement', 'fixture');
  const successor = { engineId: 'successor', alive: true, close: vi.fn() };
  if (hasSuccessor) ctx.cesarSession = successor;
  started.resolve();
  expect(await settled).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining('Session cleanup previously failed') }) });
  expect(replacement.close).toHaveBeenCalledOnce();
  expect(ctx.cesarSession).toBe(hasSuccessor ? successor : replacement);
  expect(successor.close).not.toHaveBeenCalled();
  expect(sessionCleanupFailed(ctx.cesarSession)).toBe(true);
  await expect(ensureCesarSession(ctx)).rejects.toThrow('Session cleanup previously failed');
  expect(create).toHaveBeenCalledOnce();
});

it('closes a fresh candidate whose startup rejects and retains the startup error', async () => {
  const { ctx, replacement } = fixture();
  replacement.start.mockRejectedValue(new Error('fixture start failed'));
  await expect(ensureCesarSession(ctx)).rejects.toThrow('fixture start failed');
  expect(replacement.close).toHaveBeenCalledOnce();
  expect(ctx.setCesarSession).not.toHaveBeenCalledWith(replacement);
  expect(ctx.cesarSession).toBeNull();
});

it.each(['prompt', 'restart'].flatMap(boundary => ['healthy', 'disabled', 'superseded'].map(change => ({ boundary, change }))))(
  'checks owning turn after $boundary preparation ($change)', async ({ boundary, change }) => {
    const { original, replacement, ctx } = fixture();
    const host = createCesarTurnRuntimeHost('acquisition-owner-fixture');
    ctx.cesarRuntimeHost = host;
    let disabled = false;
    beginCesarTurn(host, 'first', 'fixture', undefined, () => {
      if (disabled) throw new Error('Owner disabled');
    });
    const ready = deferred<string>();
    if (boundary === 'prompt') spine.mockReturnValue(ready.promise);
    else {
      original.engineId = 'fixture';
      original.alive = false;
      original.start.mockReturnValue(ready.promise);
    }
    const pending = ensureCesarSession(ctx);
    const settled = pending.then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(boundary === 'prompt' ? spine : original.start).toHaveBeenCalledOnce());
    if (change === 'disabled') disabled = true;
    if (change === 'superseded') beginCesarTurn(host, 'second', 'fixture');
    ready.resolve('');
    const result = await settled;
    if (change === 'healthy') {
      expect(result).toEqual({ value: replacement });
      expect(replacement.start).toHaveBeenCalledOnce();
    } else {
      expect(result).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining('DENIED') }) });
      expect(create).not.toHaveBeenCalled();
      expect(replacement.start).not.toHaveBeenCalled();
    }
  },
);

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
