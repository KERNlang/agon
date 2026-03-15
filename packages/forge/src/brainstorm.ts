import type {
  EngineAdapter,
  BrainstormBid,
  BrainstormResult,
} from '@agon/core';
import { EngineRegistry, buildBrainstormPrompt } from '@agon/core';
import {
  buildKernDraftPrompt,
  parseKernDraft,
  buildKernRankPrompt,
  type KernDraft,
} from 'kern-lang';

/**
 * Run a brainstorm across available engines using the Kern Draft Protocol.
 *
 * Flow: All engines draft (Kern format) → rank by content → winner expands.
 * ~70% fewer tokens than verbose natural language bidding.
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
  // Phase 1: All engines draft in Kern format (parallel)
  const draftPrompt = buildKernDraftPrompt({
    question: opts.question,
    context: opts.context,
    mode: 'brainstorm',
  });

  const draftPromises = opts.engines.map(async (engineId) => {
    const engine = opts.registry.get(engineId);
    try {
      const result = await opts.adapter.dispatch({
        engine,
        prompt: draftPrompt,
        cwd: process.cwd(),
        mode: 'exec',
        timeout: opts.timeout,
        outputDir: opts.outputDir,
      });

      const draft = parseKernDraft(result.stdout);
      if (draft) {
        return { engineId, draft, raw: result.stdout };
      }

      // Fallback: parse as old-style JSON bid
      return { engineId, draft: fallbackParse(result.stdout), raw: result.stdout };
    } catch {
      return {
        engineId,
        draft: {
          approach: 'Failed to respond',
          reasoning: '',
          tradeoffs: [],
          confidence: 0,
          keyFiles: [],
          steps: [],
        } satisfies KernDraft,
        raw: '',
      };
    }
  });

  const drafts = await Promise.all(draftPromises);

  // Phase 2: Rank drafts by content quality (not self-reported confidence)
  const ranked = rankDrafts(drafts);

  // Convert to BrainstormBid format for display
  const bids: BrainstormBid[] = ranked.map((d, i) => ({
    engineId: d.engineId,
    confidence: d.draft.confidence,
    reasoning: d.draft.approach + (d.draft.reasoning ? ` — ${d.draft.reasoning}` : ''),
    approach: d.draft.steps.map((s: string, j: number) => `${j + 1}. ${s}`).join('\n'),
    rank: i + 1,
  }));

  const winner = ranked[0];

  // Phase 3: Winner expands — in Kern format for token efficiency
  const winnerEngine = opts.registry.get(winner.engineId);
  const expandPrompt = [
    opts.question,
    '',
    'Your draft approach was:',
    `"${winner.draft.approach}"`,
    '',
    'Now expand your full answer. Respond in this Kern format:',
    '',
    'response {',
    '  summary: "1-2 sentence overview"',
    '  sections {',
    '    1: "section title" {',
    '      content: "detailed explanation"',
    '    }',
    '  }',
    '  steps {',
    '    1: "actionable step"',
    '    2: "actionable step"',
    '  }',
    '  conclusion: "final thought"',
    '}',
    '',
    'Be specific and actionable. Include file paths where relevant.',
  ].join('\n');

  const answerResult = await opts.adapter.dispatch({
    engine: winnerEngine,
    prompt: expandPrompt,
    cwd: process.cwd(),
    mode: 'exec',
    timeout: opts.timeout,
    outputDir: opts.outputDir,
  });

  return {
    question: opts.question,
    bids,
    winner: winner.engineId,
    response: answerResult.stdout,
  };
}

/**
 * Rank drafts by content quality — specificity, steps, tradeoffs.
 * Self-reported confidence is a weak tiebreaker, NOT the primary signal.
 */
function rankDrafts(
  drafts: { engineId: string; draft: KernDraft; raw: string }[],
): { engineId: string; draft: KernDraft; raw: string }[] {
  return [...drafts].sort((a, b) => {
    const scoreA = qualityScore(a.draft);
    const scoreB = qualityScore(b.draft);
    return scoreB - scoreA;
  });
}

/**
 * Score a draft by objective quality signals — NOT self-reported confidence.
 */
function qualityScore(draft: KernDraft): number {
  let score = 0;

  // Has a concrete approach (not empty/generic)
  if (draft.approach.length > 10) score += 20;
  if (draft.approach.length > 30) score += 10;

  // Has reasoning
  if (draft.reasoning.length > 10) score += 15;

  // Has concrete steps (more = better, up to 7)
  score += Math.min(draft.steps.length, 7) * 5;

  // Has tradeoffs (shows nuance, not just blind confidence)
  score += Math.min(draft.tradeoffs.length, 5) * 5;

  // Identifies key files (grounded in the codebase)
  score += Math.min(draft.keyFiles.length, 5) * 3;

  // Confidence as weak tiebreaker (scaled down heavily)
  score += draft.confidence * 0.05;

  return score;
}

/**
 * Fallback: parse old-style output into a KernDraft.
 */
function fallbackParse(output: string): KernDraft {
  // Try JSON extraction
  const stripped = output.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  let depth = 0;
  let start = -1;

  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (stripped[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          const parsed = JSON.parse(stripped.slice(start, i + 1));
          if (typeof parsed === 'object' && parsed !== null) {
            return {
              approach: String(parsed.approach ?? parsed.reasoning ?? ''),
              reasoning: String(parsed.reasoning ?? ''),
              tradeoffs: [],
              confidence: Number(parsed.confidence) || 50,
              keyFiles: [],
              steps: parsed.approach ? [parsed.approach] : [],
            };
          }
        } catch { /* keep looking */ }
        start = -1;
      }
    }
  }

  // Last resort: treat the whole output as the approach
  return {
    approach: output.slice(0, 200),
    reasoning: '',
    tradeoffs: [],
    confidence: 50,
    keyFiles: [],
    steps: [],
  };
}
