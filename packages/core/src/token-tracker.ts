/**
 * Token usage tracking for Agon engine dispatches.
 * Uses char/4 heuristic for estimation (good enough without a tokenizer dependency).
 */

export interface TokenUsage {
  engineId: string;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  costUsd: number;
  timestamp: number;
}

export interface SessionStats {
  totalPromptTokens: number;
  totalResponseTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  byEngine: Record<string, {
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
    costUsd: number;
    dispatches: number;
  }>;
  dispatches: number;
}

// Rough pricing per 1M tokens (input). Output is typically 3-5x more expensive
// but we simplify to a blended rate for transparency.
const COST_PER_MILLION: Record<string, number> = {
  claude: 3.00,
  codex: 2.00,
  gemini: 0.00,   // free tier
  ollama: 0.00,   // local
  aider: 3.00,
  openrouter: 2.00,
  qwen: 0.00,     // local
  mistral: 0.25,
};

/** Estimate token count from text (char/4 heuristic). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Calculate cost in USD for a given engine and token count. */
export function estimateCost(engineId: string, tokens: number): number {
  const rate = COST_PER_MILLION[engineId] ?? 2.00;
  return (tokens / 1_000_000) * rate;
}

class TokenTracker {
  private usages: TokenUsage[] = [];

  /** Record a single engine dispatch. */
  record(engineId: string, promptText: string, responseText: string): TokenUsage {
    const promptTokens = estimateTokens(promptText);
    const responseTokens = estimateTokens(responseText);
    const totalTokens = promptTokens + responseTokens;
    const costUsd = estimateCost(engineId, totalTokens);

    const usage: TokenUsage = {
      engineId,
      promptTokens,
      responseTokens,
      totalTokens,
      costUsd,
      timestamp: Date.now(),
    };

    this.usages.push(usage);
    return usage;
  }

  /** Get session-wide statistics. */
  getStats(): SessionStats {
    const byEngine: SessionStats['byEngine'] = {};

    let totalPromptTokens = 0;
    let totalResponseTokens = 0;
    let totalCostUsd = 0;

    for (const u of this.usages) {
      totalPromptTokens += u.promptTokens;
      totalResponseTokens += u.responseTokens;
      totalCostUsd += u.costUsd;

      if (!byEngine[u.engineId]) {
        byEngine[u.engineId] = {
          promptTokens: 0,
          responseTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          dispatches: 0,
        };
      }
      const e = byEngine[u.engineId];
      e.promptTokens += u.promptTokens;
      e.responseTokens += u.responseTokens;
      e.totalTokens += u.promptTokens + u.responseTokens;
      e.costUsd += u.costUsd;
      e.dispatches += 1;
    }

    return {
      totalPromptTokens,
      totalResponseTokens,
      totalTokens: totalPromptTokens + totalResponseTokens,
      totalCostUsd,
      byEngine,
      dispatches: this.usages.length,
    };
  }

  /** Get the last N usages. */
  recent(n: number = 5): TokenUsage[] {
    return this.usages.slice(-n);
  }

  /** Reset the tracker. */
  reset(): void {
    this.usages = [];
  }
}

/** Singleton tracker for the current session. */
export const tracker = new TokenTracker();
