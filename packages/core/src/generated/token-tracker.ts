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
  const COST_PER_MILLION: Record<string, number> = {
    claude: 3.00, codex: 2.00, gemini: 0.00, ollama: 0.00,
    aider: 3.00, openrouter: 2.00, qwen: 0.00, mistral: 0.25,
  };
  const rate = COST_PER_MILLION[engineId] ?? 2.00;
  return (tokens / 1_000_000) * rate;
  
}

