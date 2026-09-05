import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
const backend = vi.hoisted(() => ({ preflightApply: vi.fn(), applyPatchToTree: vi.fn(), resolveWorkingDir: vi.fn() }));
vi.mock('@kernlang/agon-core', () => backend);
import { handleApplyPatch } from '../../packages/cli/src/handlers/plan.js';

beforeEach(() => {
  vi.resetAllMocks();
  backend.resolveWorkingDir.mockReturnValue('/fixture');
  backend.preflightApply.mockReturnValue({ ok: true, dirtyTree: false, patch: {
    path: '/fixture.patch', engineId: 'fixture', content: 'approved patch bytes', lineCount: 1,
  } });
  backend.applyPatchToTree.mockReturnValue({ ok: true });
});

describe('patch approval boundary', () => {
  it('resolves an explicit relative patch against the invocation workspace', async () => {
    await handleApplyPatch(vi.fn(), { askQuestion: async () => 'n' } as unknown as HandlerContext,
      'changes.patch', false, { cwd: '/fixture' });
    expect(backend.preflightApply).toHaveBeenCalledWith('/fixture', '/fixture/changes.patch', null);
  });
  it.each([false, true])('dirty-tree force=%s never bypasses human confirmation', async force => {
    backend.preflightApply.mockReturnValue({ ok: false, dirtyTree: true, error: 'dirty', patch: {
      path: '/fixture.patch', engineId: 'fixture', content: 'fixture', lineCount: 1,
    } });
    const askQuestion = vi.fn(async () => 'no');
    const result = await handleApplyPatch(vi.fn(), { askQuestion } as unknown as HandlerContext, '/fixture.patch', force);
    expect(askQuestion).toHaveBeenCalledTimes(force ? 1 : 0);
    expect(backend.applyPatchToTree).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(force ? 0 : 1);
  });
  it.each(['n', 'no', 'not yet'])('does not apply after refusal %s', async answer => {
    const result = await handleApplyPatch(vi.fn(), { askQuestion: async () => answer } as unknown as HandlerContext, '/fixture.patch');
    expect(backend.applyPatchToTree).not.toHaveBeenCalled();
    expect(result).toMatchObject({ exitCode: 0, result: { applied: false } });
  });
  it('does not apply if cancelled while awaiting approval', async () => {
    const controller = new AbortController();
    await expect(handleApplyPatch(vi.fn(), { askQuestion: async () => { controller.abort(); return 'y'; } } as unknown as HandlerContext,
      '/fixture.patch', false, { cwd: '/fixture', signal: controller.signal })).rejects.toThrow();
    expect(backend.applyPatchToTree).not.toHaveBeenCalled();
  });
  it('keeps the approved cwd even if the process workspace selection changes', async () => {
    const result = await handleApplyPatch(vi.fn(), { askQuestion: async () => { backend.resolveWorkingDir.mockReturnValue('/different'); return 'y'; } } as unknown as HandlerContext,
      '/fixture.patch', false, { cwd: '/fixture' });
    expect(backend.applyPatchToTree).toHaveBeenCalledWith('/fixture', 'approved patch bytes');
    expect(result).toMatchObject({ exitCode: 0, result: { applied: true } });
  });
});
