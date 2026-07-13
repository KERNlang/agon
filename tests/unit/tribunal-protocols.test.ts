import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EngineRegistry } from '@kernlang/agon-core';
import type { DispatchOptions, DispatchResult, EngineAdapter, EngineDefinition } from '../../packages/core/src/types.js';
import { runTribunal } from '@kernlang/agon-forge';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

function makeEngine(id: string): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    isLocal: true,
    tier: 'user',
    binary: 'sh',
    timeout: 30,
    exec: { args: [] },
    review: { args: [] },
  } as EngineDefinition;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('tribunal execution protocols', () => {
  let agonHome: string | undefined;
  let outputDir: string | undefined;

  afterEach(() => {
    cleanupTestAgonHome(agonHome);
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
    agonHome = undefined;
    outputDir = undefined;
  });

  async function run(protocol: 'parallel' | 'chained' | 'hybrid', rounds: number) {
    agonHome = setupTestAgonHome(`tribunal-protocol-${protocol}`);
    outputDir = join(tmpdir(), `agon-tribunal-protocol-${protocol}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outputDir, { recursive: true });

    const registry = new EngineRegistry();
    const engineIds = ['alpha', 'beta', 'gamma'];
    for (const id of engineIds) registry.register(makeEngine(id));

    const prompts: Array<{ engineId: string; round: number; prompt: string }> = [];
    const activeByRound = new Map<number, number>();
    const maxActiveByRound = new Map<number, number>();
    const controller = new AbortController();
    let summarySignal: AbortSignal | undefined;

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        if (options.systemPrompt?.includes('synthesizing a debate')) {
          summarySignal = options.signal;
          return { exitCode: 0, stdout: 'summary', stderr: '', durationMs: 1, timedOut: false };
        }

        const round = Number(options.prompt.match(/## ROUND\n(\d+) of/)?.[1] ?? 0);
        prompts.push({ engineId: options.engine.id, round, prompt: options.prompt });
        const active = (activeByRound.get(round) ?? 0) + 1;
        activeByRound.set(round, active);
        maxActiveByRound.set(round, Math.max(maxActiveByRound.get(round) ?? 0, active));
        await sleep(20);
        activeByRound.set(round, active - 1);
        return {
          exitCode: 0,
          stdout: `argument-${options.engine.id}-round-${round}`,
          stderr: '',
          durationMs: 20,
          timedOut: false,
        };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    const result = await runTribunal({
      question: 'How should the protocol execute?',
      engines: engineIds,
      rounds,
      mode: 'adversarial',
      protocol,
      registry,
      adapter,
      timeout: 5,
      outputDir,
      signal: controller.signal,
    });

    return { result, prompts, maxActiveByRound, summarySignal, signal: controller.signal };
  }

  it('parallel starts every seat together without current-round context', async () => {
    const { result, prompts, maxActiveByRound, summarySignal, signal } = await run('parallel', 1);

    expect(result.protocol).toBe('parallel');
    expect(maxActiveByRound.get(1)).toBe(3);
    expect(prompts).toHaveLength(3);
    expect(prompts.every((entry) => !entry.prompt.includes('EARLIER ARGUMENTS THIS ROUND'))).toBe(true);
    expect(summarySignal).toBe(signal);
  });

  it('chained dispatches one seat at a time and passes earlier arguments forward', async () => {
    const { result, prompts, maxActiveByRound } = await run('chained', 1);

    expect(result.protocol).toBe('chained');
    expect(maxActiveByRound.get(1)).toBe(1);
    expect(prompts[0].prompt).not.toContain('EARLIER ARGUMENTS THIS ROUND');
    expect(prompts[1].prompt).toContain('argument-alpha-round-1');
    expect(prompts[2].prompt).toContain('argument-alpha-round-1');
    expect(prompts[2].prompt).toContain('argument-beta-round-1');
  });

  it('hybrid runs round one in parallel and chains later rounds', async () => {
    const { result, prompts, maxActiveByRound } = await run('hybrid', 2);

    expect(result.protocol).toBe('hybrid');
    expect(maxActiveByRound.get(1)).toBe(3);
    expect(maxActiveByRound.get(2)).toBe(1);

    const betaRoundOne = prompts.find((entry) => entry.engineId === 'beta' && entry.round === 1);
    const betaRoundTwo = prompts.find((entry) => entry.engineId === 'beta' && entry.round === 2);
    expect(betaRoundOne?.prompt).not.toContain('EARLIER ARGUMENTS THIS ROUND');
    expect(betaRoundTwo?.prompt).toContain('PREVIOUS ARGUMENTS');
    expect(betaRoundTwo?.prompt).toContain('argument-alpha-round-2');
  });
});
