import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../packages/core/src/generated/api/agent-loop.js', () => ({
  runApiAgentLoop: vi.fn(async (opts: any) => {
    if (opts.prompt === 'throw while aborted') throw new Error('AbortError');
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

import { Speculator } from '../../packages/core/src/generated/cesar/speculator.js';

describe('Speculator structured agent failures', () => {
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
