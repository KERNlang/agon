import { assignStances, fallbackParse } from './policy.js';
import type { BrainstormDraft, BrainstormWorkflowOptions } from './workflow.js';
import type { SeatOutcome } from '@kernlang/agon-support-panel';

export interface RankedBrainstormDraft {
  engineId: string;
  draft: BrainstormDraft;
  raw: string;
  seat: SeatOutcome;
}
export interface BrainstormCollection {
  ranked: RankedBrainstormDraft[];
  outcomes: SeatOutcome[];
}
export interface BrainstormCollectorServices<Options extends BrainstormWorkflowOptions> {
  buildPrompt(input: { question: string; context?: string; mode: 'brainstorm' }): string;
  parseDraft(raw: string): BrainstormDraft | null;
  selectSeat(options: Options, engineId: string): (prompt: string, systemPrompt: string) => Promise<SeatOutcome>;
  rankDrafts(drafts: RankedBrainstormDraft[], style?: string): RankedBrainstormDraft[];
}

/** Owns seat prompts, collection, parsing and ranking; host supplies dispatch effects. */
export function createBrainstormCollector<Options extends BrainstormWorkflowOptions>(services: BrainstormCollectorServices<Options>) {
  return async function collectRankedDrafts(opts: Options): Promise<BrainstormCollection> {
    const draftPrompt = services.buildPrompt({
      question: opts.question,
      context: opts.context,
      mode: 'brainstorm',
    });

    // Divergent style: each seat gets a distinct stance so the panel actually
    // spreads out instead of six engines converging on the stated framing.
    // The stance rides in the system prompt — the protocol draft prompt stays
    // byte-identical so the draft-block output contract is undisturbed.
    const stances = opts.style === 'divergent' ? assignStances(opts.engines) : null;
    const baseSystemPrompt = 'You are participating in a brainstorm. Respond directly with your analysis and approach. Do NOT use tools, do NOT read files, do NOT run commands. Just think and write your response as plain text.';

    const draftPromises = opts.engines.map(async (engineId: string) => {
      const dispatchSeat = services.selectSeat(opts, engineId);
      opts.onEvent?.({ type: 'brainstorm:seat-started', data: { engineId } });
      const stance = stances?.get(engineId);
      const systemPrompt = stance
        ? [
            baseSystemPrompt,
            '',
            `Your seat stance — ${stance}`,
            'The question may be over-specified: treat its framing as one hypothesis about the underlying problem, not a hard constraint. If a better framing exists, say so in the reasoning field.',
            'Express the stance entirely inside the draft block fields (approach/reasoning/tradeoffs/steps). Do not add any text outside the draft block.',
          ].join('\n')
        : baseSystemPrompt;
      // One auto-retry per seat (shorter timeout) — transient flake must not
      // silently shrink the promised panel. Whatever still fails gets reported
      // through the panel-health banner instead of vanishing into a 3/6 run.
      const seat = await dispatchSeat(draftPrompt, systemPrompt);
      opts.onEvent?.({ type: 'brainstorm:seat-completed', data: { engineId, ok: seat.ok, attempts: seat.attempts, failure: seat.failure, detail: seat.detail } });
      if (!seat.ok) {
        console.warn(`[agon] brainstorm dispatch (${engineId}) failed after ${seat.attempts} attempt(s): ${seat.failure}`);
        return { entry: null, seat };
      }
      const raw = seat.text;
      const draft = services.parseDraft(raw);
      if (draft) {
        return { entry: { engineId, draft, raw, seat }, seat };
      }
      return { entry: { engineId, draft: fallbackParse(raw), raw, seat }, seat };
    });

    const attempts = await Promise.all(draftPromises);
    const drafts = attempts.flatMap((attempt) => attempt.entry ? [attempt.entry] : []);
    return { ranked: services.rankDrafts(drafts, opts.style), outcomes: attempts.map((attempt) => attempt.seat) };

  };
}
