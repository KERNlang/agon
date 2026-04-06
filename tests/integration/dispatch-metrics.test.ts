import { describe, it, expect, vi } from 'vitest';
import type { DispatchMetric, EngineResult, TokenUsage } from '../../packages/core/src/types.js';

// ── 1. DispatchMetric Type Shape ──────────────────────────────────
describe('DispatchMetric Type', () => {
  it('has all required fields for stage1 phase', () => {
    const metric: DispatchMetric = {
      engineId: 'claude',
      phase: 'stage1',
      dispatchDurationMs: 5000,
      totalDurationMs: 7000,
      fitnessDurationMs: 2000,
      pass: true,
      score: 95,
      timedOut: false,
      tokens: { prompt: 1500, response: 800, costUsd: 0.0207 },
    };

    expect(metric.engineId).toBe('claude');
    expect(metric.phase).toBe('stage1');
    expect(metric.dispatchDurationMs).toBeGreaterThan(0);
    expect(metric.totalDurationMs).toBe(metric.dispatchDurationMs + (metric.fitnessDurationMs ?? 0));
    expect(metric.tokens?.costUsd).toBeGreaterThan(0);
  });

  it('has error field for failed dispatches', () => {
    const metric: DispatchMetric = {
      engineId: 'codex',
      phase: 'stage2-follower',
      dispatchDurationMs: 0,
      totalDurationMs: 0,
      error: 'Engine timed out after 120s',
    };

    expect(metric.error).toBeDefined();
    expect(metric.pass).toBeUndefined();
    expect(metric.score).toBeUndefined();
  });

  it('supports all phase types', () => {
    const phases: DispatchMetric['phase'][] = [
      'stage1', 'stage2-scout', 'stage2-follower', 'synthesis', 'gauntlet',
    ];

    for (const phase of phases) {
      const metric: DispatchMetric = {
        engineId: 'test',
        phase,
        dispatchDurationMs: 100,
        totalDurationMs: 100,
      };
      expect(metric.phase).toBe(phase);
    }
  });
});

// ── 2. Token Tracker Integration ──────────────────────────────────
describe('Token Tracker', () => {
  it('estimates tokens from text length', async () => {
    const { estimateTokens } = await import('../../packages/core/src/token-tracker.js');

    // ~4 chars per token
    expect(estimateTokens('hello world')).toBe(3); // ceil(11/4) = 3
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(1000))).toBe(250);
  });

  it('estimates cost per engine', async () => {
    const { estimateCost } = await import('../../packages/core/src/token-tracker.js');

    // Claude: $9/1M tokens
    const claudeCost = estimateCost('claude', 1_000_000);
    expect(claudeCost).toBeCloseTo(9.0, 1);

    // Ollama: free
    const ollamaCost = estimateCost('ollama', 1_000_000);
    expect(ollamaCost).toBe(0);

    // Unknown engine: $2/1M fallback
    const unknownCost = estimateCost('unknown-engine', 1_000_000);
    expect(unknownCost).toBeCloseTo(2.0, 1);
  });

  it('tracker records and aggregates by engine', async () => {
    const { TokenTracker } = await import('../../packages/core/src/token-tracker.js');
    const tracker = new TokenTracker();

    tracker.record('claude', 'prompt text here', 'response text');
    tracker.record('claude', 'another prompt', 'another response');
    tracker.record('codex', 'codex prompt', 'codex response');

    const stats = tracker.getStats();
    expect(stats.dispatches).toBe(3);
    expect(stats.byEngine['claude'].dispatches).toBe(2);
    expect(stats.byEngine['codex'].dispatches).toBe(1);
    expect(stats.totalCostUsd).toBeGreaterThan(0);

    // Claude cost should be higher than Codex (higher rate)
    expect(stats.byEngine['claude'].costUsd).toBeGreaterThan(stats.byEngine['codex'].costUsd);
  });

  it('tracker.recent returns last N entries', async () => {
    const { TokenTracker } = await import('../../packages/core/src/token-tracker.js');
    const tracker = new TokenTracker();

    for (let i = 0; i < 10; i++) {
      tracker.record(`engine-${i}`, 'p', 'r');
    }

    const recent = tracker.recent(3);
    expect(recent.length).toBe(3);
    expect(recent[0].engineId).toBe('engine-7');
    expect(recent[2].engineId).toBe('engine-9');
  });

  it('tracker.reset clears all data', async () => {
    const { TokenTracker } = await import('../../packages/core/src/token-tracker.js');
    const tracker = new TokenTracker();

    tracker.record('claude', 'p', 'r');
    expect(tracker.getStats().dispatches).toBe(1);

    tracker.reset();
    expect(tracker.getStats().dispatches).toBe(0);
    expect(tracker.getStats().totalCostUsd).toBe(0);
  });
});

// ── 3. Timeout Isolation (Promise.allSettled) ─────────────────────
describe('Timeout Isolation', () => {
  it('Promise.allSettled handles mixed success/failure', async () => {
    // Simulate the pattern used in stages.kern
    const enginePromises = [
      Promise.resolve({ engineId: 'claude', pass: true, score: 90 }),
      Promise.reject(new Error('Engine timed out')),
      Promise.resolve({ engineId: 'gemini', pass: true, score: 85 }),
    ];

    const settled = await Promise.allSettled(enginePromises);

    // Should have 2 fulfilled, 1 rejected
    const fulfilled = settled.filter(s => s.status === 'fulfilled');
    const rejected = settled.filter(s => s.status === 'rejected');

    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(1);

    // Winner determination should still work with partial results
    const results = new Map<string, any>();
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        results.set(outcome.value.engineId, outcome.value);
      }
    }

    expect(results.size).toBe(2);
    expect(results.has('claude')).toBe(true);
    expect(results.has('gemini')).toBe(true);
  });

  it('determineWinner works with partial results after engine failure', async () => {
    const { determineWinner } = await import('../../packages/forge/src/stages.js');

    // Only 2 of 3 engines returned results (one failed via allSettled)
    const results = new Map<string, EngineResult>();
    results.set('claude', {
      engineId: 'claude',
      pass: true,
      score: 90,
      diffLines: 30,
      filesChanged: 2,
      durationSec: 20,
      lintWarnings: 0,
      styleScore: 100,
    });
    results.set('gemini', {
      engineId: 'gemini',
      pass: true,
      score: 85,
      diffLines: 40,
      filesChanged: 3,
      durationSec: 25,
      lintWarnings: 1,
      styleScore: 95,
    });
    // codex is missing — it failed/timed out

    const { winner, closeCall } = determineWinner(results, 8);
    expect(winner).toBe('claude');
    // 90 - 85 = 5 < 8 spread → close call
    expect(closeCall).toBe(true);
  });
});

// ── 4. Scoring Component Breakdown ────────────────────────────────
describe('Scoring Component Breakdown', () => {
  it('computeScore returns all individual components', async () => {
    const { computeScore } = await import('../../packages/core/src/scoring.js');

    const result = computeScore({
      pass: true,
      diffLines: 50,
      filesChanged: 3,
      durationSec: 30,
      lintWarnings: 2,
      styleScore: 90,
      compositeScore: 0,
    });

    // All components should be defined
    expect(result.passScore).toBeDefined();
    expect(result.qualityScore).toBeDefined();
    expect(result.diffScore).toBeDefined();
    expect(result.filesScore).toBeDefined();
    expect(result.durationScore).toBeDefined();
    expect(result.composite).toBeDefined();

    // Pass score should be 100 (pass=true, diffLines>0)
    expect(result.passScore).toBe(100);

    // Components should all be 0-100
    for (const score of [result.passScore, result.qualityScore, result.diffScore, result.filesScore, result.durationScore]) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }

    // Composite is weighted sum
    expect(result.composite).toBeGreaterThan(0);
    expect(result.composite).toBeLessThanOrEqual(100);
  });

  it('penalizes heavily for large diffs (500+ lines)', async () => {
    const { computeScore } = await import('../../packages/core/src/scoring.js');

    const small = computeScore({
      pass: true, diffLines: 20, filesChanged: 1, durationSec: 10,
      lintWarnings: 0, styleScore: 100, compositeScore: 0,
    });

    const large = computeScore({
      pass: true, diffLines: 500, filesChanged: 1, durationSec: 10,
      lintWarnings: 0, styleScore: 100, compositeScore: 0,
    });

    // Small diff should score significantly higher
    expect(small.composite - large.composite).toBeGreaterThan(10);
    // Large diff should have diffScore near 0
    expect(large.diffScore).toBeLessThanOrEqual(5);
  });
});

// ── 5. ELO Update Integration ─────────────────────────────────────
describe('ELO Update Integration', () => {
  it('updateElo adjusts ratings after forge outcome', async () => {
    const { updateElo, getElo } = await import('../../packages/core/src/elo.js');

    // Record a win for claude over codex in refactor tasks
    const before = getElo();
    const claudeBefore = before.global?.claude?.rating ?? 1500;
    const codexBefore = before.global?.codex?.rating ?? 1500;

    updateElo('claude', 'codex', 'refactor', 32);

    const after = getElo();
    const claudeAfter = after.global?.claude?.rating ?? 1500;
    const codexAfter = after.global?.codex?.rating ?? 1500;

    // Winner rating should increase
    expect(claudeAfter).toBeGreaterThan(claudeBefore);
    // Loser rating should decrease
    expect(codexAfter).toBeLessThan(codexBefore);
    // ELO is zero-sum: winner gain + loser loss ≈ 0
    const gain = claudeAfter - claudeBefore;
    const loss = codexAfter - codexBefore;
    expect(Math.abs(gain + loss)).toBeLessThan(1);
  });

  it('ELO tracks per task class', async () => {
    const { updateElo, getElo } = await import('../../packages/core/src/elo.js');

    updateElo('gemini', 'claude', 'algorithm', 32);

    const elo = getElo();
    expect(elo.byTaskClass?.algorithm?.gemini).toBeDefined();
    expect(elo.byTaskClass?.algorithm?.gemini?.wins).toBeGreaterThanOrEqual(1);
  });
});
