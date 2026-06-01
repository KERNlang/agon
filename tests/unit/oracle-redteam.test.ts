// Unit tests for the oracle red-team pre-flight core — the pure cheat prompt and
// the warn/strict gate decision. The orchestration (running an adversarial forge
// per task) lives in the goal CLI command and is exercised end-to-end there.
import { describe, it, expect } from 'vitest';
import { buildOracleCheatPrompt, oracleGateDecision } from '@kernlang/agon-forge';
import type { OracleHole } from '@kernlang/agon-forge';

describe('buildOracleCheatPrompt', () => {
  it('embeds the gap + verify and demands a degenerate cheat, not a real impl', () => {
    const p = buildOracleCheatPrompt({ source: 'implement pow(a,b)', verify: 'node -e "assert(pow(2,3)===8)"' });
    expect(p).toContain('implement pow(a,b)');
    expect(p).toContain('node -e "assert(pow(2,3)===8)"');
    expect(p.toLowerCase()).toContain('cheat');
    expect(p).toMatch(/do not implement/i);
    expect(p.toLowerCase()).toContain('hardcode');
  });
});

describe('oracleGateDecision', () => {
  const hole = (taskId: string): OracleHole => ({ taskId, engine: 'codex', evidence: 'cheat passed' });

  it('no holes -> never abort, clean summary', () => {
    const d = oracleGateDecision([], 'strict');
    expect(d.abort).toBe(false);
    expect(d.summary).toMatch(/no gameable/i);
  });

  it('warn + holes -> proceed with a loud summary naming the tasks', () => {
    const d = oracleGateDecision([hole('t1')], 'warn');
    expect(d.abort).toBe(false);
    expect(d.summary).toContain('t1');
    expect(d.summary).toMatch(/gameable/i);
  });

  it('strict + holes -> abort the launch', () => {
    const d = oracleGateDecision([hole('t1'), hole('t2')], 'strict');
    expect(d.abort).toBe(true);
    expect(d.summary).toContain('t1');
    expect(d.summary).toContain('t2');
  });

  it('only strict aborts — an unexpected mode with holes does not', () => {
    expect(oracleGateDecision([hole('t1')], 'off').abort).toBe(false);
    expect(oracleGateDecision([hole('t1')], 'warn').abort).toBe(false);
  });
});
