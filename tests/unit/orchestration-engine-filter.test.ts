import { describe, expect, it } from 'vitest';
import { filterDefaultOrchestrationEngines, isDefaultOrchestrationEngineAllowed } from '../../packages/cli/src/generated/handlers/engine-filter.js';

describe('orchestration engine filter', () => {
  it('keeps default orchestration off disabled local/problem engines but keeps usable subvariants like kimi-for-coding-*', () => {
    expect(filterDefaultOrchestrationEngines([
      'claude',
      'codex',
      'gemini',
      'ollama',
      'qwen',
      'opencode',
      'kimi',
      'kimi-code',
      'minimax',
      'kimi-for-coding-k2p6',
      'minimax-coding-plan-minimax-m2.7-highspeed',
      'zai-coding-plan-glm-5.1',
    ])).toEqual([
      'claude',
      'codex',
      'gemini',
      'kimi-code',
      'kimi-for-coding-k2p6',
      'minimax-coding-plan-minimax-m2.7-highspeed',
      'zai-coding-plan-glm-5.1',
    ]);
  });

  it('matches prefix-excluded engine ids case-insensitively', () => {
    expect(isDefaultOrchestrationEngineAllowed('Ollama')).toBe(false);
    expect(isDefaultOrchestrationEngineAllowed('OPENCODE-experimental')).toBe(false);
    expect(isDefaultOrchestrationEngineAllowed('codex')).toBe(true);
  });

  it('blocks vanilla kimi/minimax exactly but keeps their usable subvariants', () => {
    expect(isDefaultOrchestrationEngineAllowed('kimi')).toBe(false);
    expect(isDefaultOrchestrationEngineAllowed('KIMI')).toBe(false);
    expect(isDefaultOrchestrationEngineAllowed('kimi-code')).toBe(true);
    expect(isDefaultOrchestrationEngineAllowed('kimi-for-coding-k2p6')).toBe(true);
    expect(isDefaultOrchestrationEngineAllowed('minimax')).toBe(false);
    expect(isDefaultOrchestrationEngineAllowed('minimax-coding-plan-minimax-m2.7-highspeed')).toBe(true);
  });
});
