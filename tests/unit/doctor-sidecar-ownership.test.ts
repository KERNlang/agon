import { beforeEach, describe, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({
  spawn: vi.fn(),
  dedup: vi.fn(),
  history: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: effects.spawn,
}));
vi.mock('@kernlang/agon-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@kernlang/agon-core')>(),
  resolveSidecarPython: () => '/fixture/python',
  resolveDedupSidecar: effects.dedup,
}));
vi.mock('@kernlang/agon-support-persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@kernlang/agon-support-persistence')>(),
  resolveHistorySearchSidecar: effects.history,
}));

import { diagnoseDedupPython } from '../../packages/cli/src/commands/doctor.js';

beforeEach(() => {
  vi.resetAllMocks();
  effects.spawn.mockReturnValue({ status: 0, stdout: '', stderr: '' });
  effects.dedup.mockImplementation((name: string) => `/fixture/dedup/${name}`);
  effects.history.mockReturnValue('/fixture/persistence/history-search.py');
});

describe('Doctor physical sidecar ownership', () => {
  it('accepts the executing history sidecar without a legacy copy', () => {
    effects.dedup.mockImplementation((name: string) => name === 'history-search.py' ? null : `/fixture/dedup/${name}`);

    const result = diagnoseDedupPython();

    expect(result.status).toBe('ok');
    expect(result.detail).toContain('/fixture/persistence/history-search.py');
    expect(effects.dedup).not.toHaveBeenCalledWith('history-search.py');
    expect(effects.spawn).toHaveBeenCalledWith('/fixture/python', ['-c', expect.stringContaining('import fastembed')],
      { encoding: 'utf-8', timeout: 15000 });
  });

  it('rejects a missing physical history asset even if a legacy copy exists', () => {
    effects.history.mockReturnValue(null);

    const result = diagnoseDedupPython();

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('history-search.py');
    expect(result.detail).toContain('@kernlang/agon-support-persistence');
    expect(result.installCommand).toContain('@kernlang/agon-support-persistence');
  });

  it('identifies the dedup owner when another required asset is missing', () => {
    effects.dedup.mockImplementation((name: string) => name === 'embedder.py' ? null : `/fixture/dedup/${name}`);

    const result = diagnoseDedupPython();

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('embedder.py');
    expect(result.detail).toContain('@kernlang/agon-support-dedup');
    expect(result.installCommand).toContain('@kernlang/agon-support-dedup');
    expect(result.installCommand).not.toContain('@kernlang/agon-support-persistence');
  });

  it('identifies both owners when no sidecars resolve', () => {
    effects.history.mockReturnValue(null);
    effects.dedup.mockReturnValue(null);

    const result = diagnoseDedupPython();

    expect(result.status).toBe('fail');
    expect(result.installCommand).toContain('@kernlang/agon-support-persistence');
    expect(result.installCommand).toContain('@kernlang/agon-support-dedup');
  });

  it('retains the managed installer advice for missing Python dependencies', () => {
    effects.spawn.mockReturnValue({ status: 1, stderr: "ModuleNotFoundError: No module named 'fastembed'" });

    const result = diagnoseDedupPython();

    expect(result.status).toBe('warn');
    expect(result.detail).toContain('fastembed');
    expect(result.installCommand).toBe('node /fixture/dedup/install-python.mjs');
    expect(effects.history).not.toHaveBeenCalled();
  });

  it('reports an unavailable Python process before checking assets', () => {
    effects.spawn.mockReturnValue({ status: null, error: new Error('spawn ENOENT') });

    expect(diagnoseDedupPython()).toMatchObject({ status: 'fail', detail: 'spawn ENOENT' });
    expect(effects.history).not.toHaveBeenCalled();
  });
});
