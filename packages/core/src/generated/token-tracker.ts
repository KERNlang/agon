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
  byEngine: Record<string,{promptTokens:number;responseTokens:number;totalTokens:number;costUsd:number;dispatches:number}>;
  dispatches: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCost(engineId: string, tokens: number): number {
  // Approximate blended cost per 1M tokens (input+output avg). Updated 2026-03.
  // Local engines (ollama) = free. Gemini free tier assumed. Adjust via config if needed.
  const COST_PER_MILLION: Record<string, number> = {
    claude: 9.00, codex: 5.00, gemini: 1.25, ollama: 0.00,
    aider: 9.00, openrouter: 3.00, qwen: 0.50, mistral: 0.50,
    opencode: 5.00,
  };
  const rate = COST_PER_MILLION[engineId] ?? 2.00;
  return (tokens / 1_000_000) * rate;
}

export class TokenTracker {
  private usages: TokenUsage[] = [];

  record(engineId: string, promptText: string, responseText: string): TokenUsage {
    const promptTokens = estimateTokens(promptText);
    const responseTokens = estimateTokens(responseText);
    const totalTokens = promptTokens + responseTokens;
    const costUsd = estimateCost(engineId, totalTokens);
    const usage: TokenUsage = { engineId, promptTokens, responseTokens, totalTokens, costUsd, timestamp: Date.now() };
    this.usages.push(usage);
    return usage;
  }

  getStats(): SessionStats {
    const byEngine: SessionStats['byEngine'] = {};
    let totalPromptTokens = 0, totalResponseTokens = 0, totalCostUsd = 0;
    for (const u of this.usages) {
      totalPromptTokens += u.promptTokens;
      totalResponseTokens += u.responseTokens;
      totalCostUsd += u.costUsd;
      if (!byEngine[u.engineId]) byEngine[u.engineId] = { promptTokens: 0, responseTokens: 0, totalTokens: 0, costUsd: 0, dispatches: 0 };
      const e = byEngine[u.engineId];
      e.promptTokens += u.promptTokens; e.responseTokens += u.responseTokens;
      e.totalTokens += u.promptTokens + u.responseTokens; e.costUsd += u.costUsd; e.dispatches += 1;
    }
    return { totalPromptTokens, totalResponseTokens, totalTokens: totalPromptTokens + totalResponseTokens, totalCostUsd, byEngine, dispatches: this.usages.length };
  }

  recent(n: number = 5): TokenUsage[] {
    return this.usages.slice(-n);
  }

  reset(): void {
    this.usages = [];
  }
}

export const tracker = new TokenTracker();

