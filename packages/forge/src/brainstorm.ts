import type {
  EngineAdapter,
  BrainstormBid,
  BrainstormResult,
} from '@agon/core';
import { EngineRegistry, buildBrainstormPrompt } from '@agon/core';

/**
 * Run a confidence-bidding brainstorm across available engines.
 */
export async function runBrainstorm(opts: {
  question: string;
  context?: string;
  engines: string[];
  registry: EngineRegistry;
  adapter: EngineAdapter;
  timeout: number;
  outputDir: string;
}): Promise<BrainstormResult> {
  const bidPrompt = buildBrainstormPrompt({
    question: opts.question,
    context: opts.context,
  });

  // Phase 1: Collect bids (parallel)
  const bidPromises = opts.engines.map(async (engineId) => {
    const engine = opts.registry.get(engineId);
    try {
      const result = await opts.adapter.dispatch({
        engine,
        prompt: bidPrompt,
        cwd: process.cwd(),
        mode: 'exec',
        timeout: opts.timeout,
        outputDir: opts.outputDir,
      });

      return parseBid(engineId, result.stdout);
    } catch {
      return {
        engineId,
        confidence: 0,
        reasoning: 'Failed to respond',
        approach: '',
      } satisfies BrainstormBid;
    }
  });

  const bids = await Promise.all(bidPromises);

  // Phase 2: Pick winner (highest confidence)
  const sortedBids = [...bids].sort((a, b) => b.confidence - a.confidence);
  const winner = sortedBids[0];

  // Phase 3: Dispatch winner for the full answer
  const winnerEngine = opts.registry.get(winner.engineId);
  const answerResult = await opts.adapter.dispatch({
    engine: winnerEngine,
    prompt: opts.question,
    cwd: process.cwd(),
    mode: 'exec',
    timeout: opts.timeout,
    outputDir: opts.outputDir,
  });

  return {
    question: opts.question,
    bids: sortedBids,
    winner: winner.engineId,
    response: answerResult.stdout,
  };
}

function parseBid(engineId: string, output: string): BrainstormBid {
  try {
    const parsed = extractJson(output);
    if (!parsed) throw new Error('No JSON found');

    return {
      engineId,
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
      reasoning: String(parsed.reasoning ?? ''),
      approach: String(parsed.approach ?? ''),
    };
  } catch {
    return {
      engineId,
      confidence: 50,
      reasoning: 'Could not parse bid response',
      approach: output.slice(0, 200),
    };
  }
}

/**
 * Robustly extract JSON from LLM output.
 * Handles: raw JSON, markdown-fenced JSON, JSON buried in text.
 */
function extractJson(text: string): Record<string, unknown> | null {
  // Strip markdown code fences
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');

  // Try each { position as a potential JSON start
  let depth = 0;
  let start = -1;

  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (stripped[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = stripped.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          // Must have at least a confidence field to be a valid bid
          if (typeof parsed === 'object' && parsed !== null && 'confidence' in parsed) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          // Not valid JSON, keep looking
        }
        start = -1;
      }
    }
  }

  // Fallback: try the whole text as JSON
  try {
    return JSON.parse(stripped.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
