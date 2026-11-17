import { afterEach, describe, expect, it, vi } from 'vitest';
import * as owner from '@kernlang/agon-mod-mutate';
import { runMutate, dedupeMutants, selectMutants } from '../../packages/forge/src/mutate.js';
import type { MutateOptions } from '../../packages/forge/src/mutate.js';
import { resolveMutateTargets } from '../../packages/forge/src/mutate-targets.js';
import { prepareNodeSandbox } from '../../packages/forge/src/mutate-sandbox.js';
import { formatMutateVerdict, staleDistHint } from '../../packages/forge/src/mutate-report.js';

afterEach(() => vi.restoreAllMocks());

describe('legacy Mutate workflow owner', () => {
  it('uses the owner pool policy through existing public imports', () => {
    expect(dedupeMutants).toBe(owner.dedupeMutants);
    expect(selectMutants).toBe(owner.selectMutants);
  });

  it('delegates unchanged options and preserves host effects and result identity', async () => {
    const opts: MutateOptions = { repoRoot: process.cwd(), testCmd: '', engines: [],
      registry: {} as never, adapter: {} as never, semantic: false, maxMutants: 1,
      perMutantTimeoutSec: 1, totalBudgetSec: 1, outputDir: process.cwd() };
    const expected = { ok: false, report: {}, survivors: [], byFile: {}, verdict: 'fixture',
      costUsd: 0, engineCalls: 0, label: 'fixture', outputDir: process.cwd() } as owner.MutateResult;
    const run = vi.spyOn(owner, 'runLegacyMutate').mockResolvedValue(expected);
    expect(await runMutate(opts)).toBe(expected);
    expect(run).toHaveBeenCalledWith(opts, {
      resolveMutateTargets, prepareNodeSandbox, formatMutateVerdict, staleDistHint,
      collectSemanticMutants: expect.any(Function),
    });
  });
});
