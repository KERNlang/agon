import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import type { Dispatch } from '../../packages/cli/src/handlers/types.js';
import { createPatchApplicationUi, patchApplicationHost, withPatchApplication } from '../../packages/cli/src/patch-application-host.js';
const backend = vi.hoisted(() => ({ preflightApply: vi.fn(), applyPatchToTree: vi.fn(), resolveWorkingDir: vi.fn(), inspectWorkingTree: vi.fn() }));
vi.mock('@kernlang/agon-support-worktree', async original => ({ ...await original<Record<string, unknown>>(), ...backend }));
import { runApply } from '../../packages/mod-forge/src/apply.js';
import type { ModServices } from '@kernlang/agon-mod-api';

async function handleApplyPatch(dispatch: Dispatch, ctx: HandlerContext, patchPath?: string, force?: boolean,
  invocation: { cwd?: string; signal?: AbortSignal } = {}) {
  const context = { invocationId: 'approval-test', cwd: invocation.cwd ?? backend.resolveWorkingDir(),
    signal: invocation.signal ?? new AbortController().signal, platform: 'darwin-arm64' as const, config: {} };
  const uiDispatch: Dispatch = event => {
    dispatch(event);
    if (event.type === 'question') void ctx.askQuestion(event.prompt).then(event.resolve);
  };
  return withPatchApplication(context.invocationId, createPatchApplicationUi(uiDispatch, ctx), () =>
    runApply({ ...(patchPath ? { patchPath } : {}), force: force === true }, context,
      { patchApplication: patchApplicationHost } as ModServices));
}

beforeEach(() => {
  vi.resetAllMocks();
  backend.resolveWorkingDir.mockReturnValue('/fixture');
  backend.inspectWorkingTree.mockReturnValue({ ok: true, dirtyTree: false });
  backend.preflightApply.mockReturnValue({ ok: true, dirtyTree: false, patch: {
    path: '/fixture.patch', engineId: 'fixture', content: 'approved patch bytes', lineCount: 1,
  } });
  backend.applyPatchToTree.mockReturnValue({ ok: true });
});

describe('patch approval boundary', () => {
  it('resolves an explicit relative patch against the invocation workspace', async () => {
    await handleApplyPatch(vi.fn(), { askQuestion: async () => 'n' } as unknown as HandlerContext,
      'changes.patch', false, { cwd: '/fixture' });
    expect(backend.preflightApply).toHaveBeenCalledWith('/fixture', '/fixture/changes.patch', null, { allowDirty: false });
  });
  it.each([false, true])('dirty-tree force=%s never bypasses human confirmation', async force => {
    backend.preflightApply.mockImplementation((_cwd, _patch, _manifest, options) => ({ ok: options.allowDirty === true, dirtyTree: true, error: 'dirty', patch: {
      path: '/fixture.patch', engineId: 'fixture', content: 'fixture', lineCount: 1,
    } }));
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
