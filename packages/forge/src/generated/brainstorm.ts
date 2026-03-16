import type { EngineAdapter, BrainstormBid, BrainstormResult } from '@agon/core';

import { EngineRegistry, buildBrainstormPrompt } from '@agon/core';

import { buildKernDraftPrompt, parseKernDraft, buildKernRankPrompt } from 'kern-lang';

import type { KernDraft } from 'kern-lang';

export function qualityScore(draft: KernDraft): number {
  let score = 0;
  if (draft.approach.length > 10) score += 20;
  if (draft.approach.length > 30) score += 10;
  if (draft.reasoning.length > 10) score += 15;
  score += Math.min(draft.steps.length, 7) * 5;
  score += Math.min(draft.tradeoffs.length, 5) * 5;
  score += Math.min(draft.keyFiles.length, 5) * 3;
  score += draft.confidence * 0.05;
  return score;
  
}

export function rankDrafts(drafts: {engineId:string, draft: KernDraft, raw: string}[]): {engineId:string, draft:KernDraft, raw:string}[] {
  return [...drafts].sort((a, b) => {
    const scoreA = qualityScore(a.draft);
    const scoreB = qualityScore(b.draft);
    return scoreB - scoreA;
  });
  
}

export function fallbackParse(output: string): KernDraft {
  const stripped = output.replace(/\x60\x60\x60(?:json)?\s*/gi, '').replace(/\x60\x60\x60/g, '');
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
  
  return {
    approach: output.slice(0, 200),
    reasoning: '',
    tradeoffs: [],
    confidence: 50,
    keyFiles: [],
    steps: [],
  };
  
}

export async function runBrainstorm(opts: {question:string, context?: string, engines: string[], registry: EngineRegistry, adapter: EngineAdapter, timeout: number, outputDir: string, signal?: AbortSignal}): Promise<BrainstormResult> {
  const draftPrompt = buildKernDraftPrompt({
    question: opts.question,
    context: opts.context,
    mode: 'brainstorm',
  });
  
  const draftPromises = opts.engines.map(async (engineId: string) => {
    const engine = opts.registry.get(engineId);
    try {
      const result = await opts.adapter.dispatch({
        engine,
        prompt: draftPrompt,
        cwd: process.cwd(),
        mode: 'exec',
        timeout: opts.timeout,
        outputDir: opts.outputDir,
        signal: opts.signal,
      });
  
      const draft = parseKernDraft(result.stdout);
      if (draft) {
        return { engineId, draft, raw: result.stdout };
      }
  
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
  
  const ranked = rankDrafts(drafts);
  
  const bids: BrainstormBid[] = ranked.map((d, i) => ({
    engineId: d.engineId,
    confidence: d.draft.confidence,
    reasoning: d.draft.approach + (d.draft.reasoning ? ` — ${d.draft.reasoning}` : ''),
    approach: d.draft.steps.map((s: string, j: number) => `${j + 1}. ${s}`).join('\n'),
  }));
  
  const winner = ranked[0];
  
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
    signal: opts.signal,
  });
  
  return {
    question: opts.question,
    bids,
    winner: winner.engineId,
    response: answerResult.stdout,
  };
  
}

