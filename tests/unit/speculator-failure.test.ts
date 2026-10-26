import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

vi.mock('../../packages/core/src/api/agent-loop.js', () => ({
  runApiAgentLoop: vi.fn(async (opts: any) => {
    if (opts.prompt === 'throw while aborted') throw new Error('AbortError');
    if (opts.api.model === 'worktree-success') {
      writeFileSync(join(opts.cwd, 'fixture.txt'), 'shell candidate edit');
      return { response: 'shell success', toolCalls: 1, steps: 1 };
    }
    if (opts.api.model === 'slow-success') {
      await new Promise((resolve) => setTimeout(resolve, 15));
      opts.virtualFs.write(join(opts.cwd, 'slow.txt'), 'slow');
      return { response: 'slow success', toolCalls: 1, steps: 1 };
    }
    if (opts.api.model === 'fast-success') {
      opts.virtualFs.write(join(opts.cwd, 'fast.txt'), 'fast');
      return { response: 'fast success', toolCalls: 1, steps: 1 };
    }
    if (opts.api.model === 'harvestable') {
      opts.virtualFs.write(join(opts.cwd, 'fixture.txt'), 'harvestable candidate edit');
      return {
        response: 'incomplete candidate',
        toolCalls: 10,
        steps: 10,
        failed: true,
        harvestable: true,
        errorReason: 'tool loop limit',
      };
    }
    opts.virtualFs.write(join(opts.cwd, 'fixture.txt'), 'failed candidate edit');
    return {
      response: 'partial failed candidate',
      toolCalls: 1,
      steps: 1,
      failed: true,
      errorReason: 'stream closed',
    };
  }),
}));

import { Speculator } from '../../packages/core/src/cesar/speculator.js';

describe('Speculator structured agent failures', () => {
  it.each([false, true])('cleans isolated worktrees and respects cancellation=%s before publishing shell edits', async cancelled => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-speculator-shell-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
    const file = join(cwd, 'fixture.txt');
    const controller = new AbortController();
    try {
      git('init', '-b', 'main');
      writeFileSync(file, 'original');
      git('add', 'fixture.txt');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'base');
      const before = git('worktree', 'list', '--porcelain');
      const result = await new Speculator().run({
        cwd, prompt: 'edit isolated worktree', signal: controller.signal,
        members: [{ engineId: 'worker', api: { baseUrl: 'https://example.invalid/v1', model: 'worktree-success' } }],
        onMemberComplete: () => { if (cancelled) controller.abort(); },
      });
      expect(readFileSync(file, 'utf8')).toBe(cancelled ? 'original' : 'shell candidate edit');
      expect(result.appliedFiles).toEqual(cancelled ? [] : ['fixture.txt']);
      expect(result.winnerId).toBe(cancelled ? null : 'worker');
      expect(git('worktree', 'list', '--porcelain')).toBe(before);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.each(['fast-success', 'harvestable'])('does not publish a %s candidate after caller cancellation', async model => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-speculator-late-abort-'));
    const file = join(cwd, model === 'fast-success' ? 'fast.txt' : 'fixture.txt');
    writeFileSync(file, 'original');
    const controller = new AbortController();
    try {
      const result = await new Speculator().run({
        cwd, prompt: 'candidate ready before cancellation', isolate: false,
        signal: controller.signal,
        members: [{ engineId: 'worker', api: { baseUrl: 'https://example.invalid/v1', model } }],
        onMemberComplete: () => controller.abort(),
      });
      expect(controller.signal.aborted).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe('original');
      expect(result.appliedFiles).toEqual([]);
      expect(result.winnerId).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('keeps a failed candidate for diagnostics but never selects or applies it', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-speculator-failure-'));
    const file = join(cwd, 'fixture.txt');
    writeFileSync(file, 'original');

    try {
      const result = await new Speculator().run({
        cwd,
        prompt: 'edit fixture',
        isolate: false,
        members: [{
          engineId: 'failed-engine',
          api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'TEST_KEY', model: 'test' },
        }],
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].effects).toHaveLength(1);
      expect(result.scores['failed-engine']).toBe(0);
      expect(result.winnerId).toBeNull();
      expect(result.appliedFiles).toEqual([]);
      expect(readFileSync(file, 'utf8')).toBe('original');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('classifies a thrown caller abort as cancelled and ineligible', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-speculator-abort-'));
    const controller = new AbortController();
    controller.abort();

    try {
      const result = await new Speculator().run({
        cwd,
        prompt: 'throw while aborted',
        isolate: false,
        signal: controller.signal,
        members: [{
          engineId: 'cancelled-engine',
          api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'TEST_KEY', model: 'test' },
        }],
      });
      expect(result.scores['cancelled-engine']).toBe(0);
      expect(result.winnerId).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('scores and applies an explicitly harvestable incomplete candidate', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-speculator-harvestable-'));
    const file = join(cwd, 'fixture.txt');
    writeFileSync(file, 'original');

    try {
      const result = await new Speculator().run({
        cwd,
        prompt: 'edit fixture',
        isolate: false,
        members: [{
          engineId: 'harvestable-engine',
          api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'TEST_KEY', model: 'harvestable' },
        }],
      });

      expect(result.scores['harvestable-engine']).toBeGreaterThan(0);
      expect(result.winnerId).toBe('harvestable-engine');
      expect(readFileSync(file, 'utf8')).toBe('harvestable candidate edit');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('keeps member ordering deterministic and isolates callback failures', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-speculator-order-'));

    try {
      const result = await new Speculator().run({
        cwd,
        prompt: 'parallel candidates',
        isolate: false,
        onMemberComplete: () => { throw new Error('listener failed'); },
        members: [
          { engineId: 'slow', api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'TEST_KEY', model: 'slow-success' } },
          { engineId: 'fast', api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'TEST_KEY', model: 'fast-success' } },
        ],
      });

      expect(result.candidates.map((candidate) => candidate.engineId)).toEqual(['slow', 'fast']);
      expect(result.winnerId).not.toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
