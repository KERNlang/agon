import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { EngineDefinition } from '@kernlang/agon-core';
import { judgeIneligibility } from '../../packages/forge/src/judge-pool.js';

const engineJson = (id: string) => JSON.parse(readFileSync(new URL(`../../engines/${id}.json`, import.meta.url), 'utf-8')) as EngineDefinition;

describe('judgeIneligibility — a judge must be unable to run tools or write', () => {
  it('B1 rules out a blanket write/auto-approve engine (agy) and CLI engines whose backend ignores textOnly (claude, codex)', () => {
    expect(judgeIneligibility(engineJson('agy'))).toBe('write-capable');
    expect(judgeIneligibility(engineJson('claude'))).toBe('not-text-only');
    expect(judgeIneligibility(engineJson('codex'))).toBe('not-text-only');
  });

  it('B1 accepts an API-only engine, whose every dispatch is a tool-free API call', () => {
    expect(judgeIneligibility(engineJson('minimax-coding-plan-minimax-m3'))).toBeNull();
  });

  it('B1 rules out an unknown engine, an engine with no backend, and an API engine whose exec args grant write access', () => {
    const api = engineJson('minimax-coding-plan-minimax-m3');
    expect(judgeIneligibility(undefined)).toBe('unknown-engine');
    expect(judgeIneligibility({ ...api, api: undefined })).toBe('not-text-only');
    expect(judgeIneligibility({ ...api, exec: { args: ['--dangerously-skip-permissions'] } } as EngineDefinition)).toBe('write-capable');
  });
});
