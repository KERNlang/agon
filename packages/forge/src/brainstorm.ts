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
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');

    const parsed = JSON.parse(jsonMatch[0]) as {
      confidence?: number;
      reasoning?: string;
      approach?: string;
    };

    return {
      engineId,
      confidence: Math.min(100, Math.max(0, parsed.confidence ?? 0)),
      reasoning: parsed.reasoning ?? '',
      approach: parsed.approach ?? '',
    };
  } catch {
    return {
      engineId,
      confidence: 50, // default mid-range
      reasoning: 'Could not parse bid response',
      approach: output.slice(0, 200),
    };
  }
}
