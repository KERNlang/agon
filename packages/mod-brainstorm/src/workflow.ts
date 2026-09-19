import { randomUUID } from 'node:crypto';
import { buildPanelHealth } from '@kernlang/agon-support-panel';
import type { SeatOutcome } from '@kernlang/agon-support-panel';

export interface BrainstormDraft {
  approach: string;
  reasoning: string;
  tradeoffs: string[];
  confidence: number;
  keyFiles: string[];
  steps: string[];
}
export interface BrainstormBid {
  engineId: string;
  confidence: number;
  reasoning: string;
  approach: string;
  score?: number;
}
export interface BrainstormWorkflowOptions {
  question: string;
  context?: string;
  engines: string[];
  style?: string;
  timeout: number;
  outputDir: string;
  signal?: AbortSignal;
  onEvent?: (event: { type: string; data?: Record<string, unknown> }) => void;
}
export interface BrainstormWorkflowServices<Options extends BrainstormWorkflowOptions> {
  seed(options: Options): void;
  preflight(options: Options): Promise<{
    healthy: string[];
    skipped: { engineId: string; status: string; reason: string }[];
  }>;
  createLogger(options: { sessionId: string; sessionType: 'brainstorm'; outputDir: string }): {
    log(event: string, engineId: string | undefined, data: Record<string, unknown>): void;
  };
  collect(options: Options, engines: string[], style: string): Promise<{
    ranked: { engineId: string; draft: BrainstormDraft; raw: string; seat: SeatOutcome }[];
    outcomes: SeatOutcome[];
  }>;
  qualityScore(engineId: string, draft: BrainstormDraft, style: string): number;
  calibrateConfidence(engineId: string, confidence: number): number;
  deduplicate(drafts: { engineId: string; text: string }[], options: { signal?: AbortSignal }): Promise<{
    groups: { members: string[]; representative: string; similarity: number }[] | null;
    status: { status: 'not-needed' | 'applied' | 'unavailable' | 'failed' | 'timed-out'; detail?: string };
  }>;
  updateRatings(bids: BrainstormBid[], question: string): void;
  /** Resolve the winner before dispatch, preserving lookup failures outside synthesis fallback. */
  selectWinner(options: Options, engineId: string): (prompt: string) => Promise<{
    exitCode: number; stdout: string; stderr?: string;
  }>;
}

/** Owns workflow decisions; injected capabilities own engine, storage and native effects. */
export function createBrainstormWorkflow<Options extends BrainstormWorkflowOptions>(services: BrainstormWorkflowServices<Options>) {
  return async function runBrainstormWorkflow(opts: Options) {
    const brainstormId = randomUUID().slice(0, 8);
    // 'divergent' is the default: brainstorm exists to spread the panel out.
    // 'grounded' restores the pre-stance behavior (convergent, file-path-anchored).
    const style = opts.style === 'grounded' ? 'grounded' : 'divergent';
    // Cold-start: seed newly-dropped model versions from their predecessor before
    // bidding, so a new engine competes at its family's strength, not 1500.
    services.seed(opts);
    // Pre-flight: drop session-quarantined engines (Layer 1, pure zero-dispatch)
    // so a dead engine doesn't burn a draft slot + a per-engine timeout. Probe opt-in.
    const __hc = await services.preflight(opts);
    for (const s of __hc.skipped) console.warn(`[agon] brainstorm: skipping ${s.engineId} — ${s.status} (${s.reason})`);
    const __engines = __hc.healthy;
    if (__engines.length === 0) {
      throw new Error(`No healthy engines for brainstorm; all ${__hc.skipped.length} were quarantined this session (${__hc.skipped.map((s) => s.engineId).join(', ')}). Restore with 'agon engine add <id>'.`);
    }
    const sidechain = services.createLogger({
      sessionId: brainstormId,
      sessionType: 'brainstorm',
      outputDir: opts.outputDir,
    });
    sidechain.log('brainstorm:init', undefined, { question: opts.question, engines: __engines, style });

    const skippedOutcomes: SeatOutcome[] = __hc.skipped.map((s) => ({
      engineId: s.engineId,
      ok: false,
      text: '',
      attempts: 0,
      failure: 'error',
      note: `${s.engineId} skipped — ${s.status} (${s.reason})`,
      detail: s.reason,
    }));
    for (const seat of skippedOutcomes) {
      opts.onEvent?.({ type: 'brainstorm:seat-completed', data: { engineId: seat.engineId, ok: false, attempts: 0, failure: seat.failure, detail: seat.detail } });
    }

    const collected = await services.collect(opts, __engines, style);
    const ranked = collected.ranked;

    // LOUD degradation: the run must never quietly complete as a smaller
    // committee. The banner prints here AND rides on the result so every
    // surface (CLI, REPL, call.ts) can show it.
    const panelHealth = buildPanelHealth([...skippedOutcomes, ...collected.outcomes]);
    if (panelHealth.banner) console.warn(`[agon] brainstorm ${panelHealth.banner}`);
    sidechain.log('brainstorm:panel-health', undefined, panelHealth);

    const bids: BrainstormBid[] = ranked.map((d) => {
      const reasoning = d.draft.approach + (d.draft.reasoning ? ` — ${d.draft.reasoning}` : '');
      const approach = d.draft.steps.map((s: string, j: number) => `${j + 1}. ${s}`).join('\n');
      const score = services.qualityScore(d.engineId, d.draft, style);
      return {
        engineId: d.engineId,
        confidence: services.calibrateConfidence(d.engineId, d.draft.confidence),
        reasoning: reasoning || d.raw.slice(0, 300) || '[No response]',
        approach: approach || '',
        score,
      };
    });

    const winner = ranked[0];
    if (!winner) {
      sidechain.log('brainstorm:failed', undefined, { reason: 'no-usable-drafts', panelHealth });
      throw new Error(`Brainstorm failed: no engine produced a usable draft. ${panelHealth.banner ?? `${panelHealth.responded}/${panelHealth.requested} responded`}`);
    }

    // Cluster paraphrased drafts via Python embedding sidecar.
    // Best-effort — null result means caller falls back to no-dedup display.
    opts.onEvent?.({ type: 'brainstorm:dedup-started', data: { drafts: bids.length } });
    const dedup = await services.deduplicate(
      ranked.map((d) => ({ engineId: d.engineId, text: d.raw || d.draft.approach || '' })),
      { signal: opts.signal },
    );
    opts.onEvent?.({ type: 'brainstorm:dedup-completed', data: { status: dedup.status.status, detail: dedup.status.detail } });
    if (dedup.status.status !== 'applied' && dedup.status.status !== 'not-needed') {
      console.warn(`[agon] brainstorm dedup ${dedup.status.status}${dedup.status.detail ? `: ${dedup.status.detail}` : ''}`);
    }
    sidechain.log('brainstorm:dedup', undefined, { ...dedup.status });

    // Update Glicko-2 ratings for all ranked engines
    if (bids.length >= 2) {
      services.updateRatings(bids, opts.question);
    }

    const synthesize = services.selectWinner(opts, winner.engineId);

    // Build synthesis prompt with ALL engines' drafts
    const allDrafts = ranked.map((d) => {
      const steps = d.draft.steps.map((s: string, j: number) => `  ${j + 1}. ${s}`).join('\n');
      return `## ${d.engineId} (confidence: ${d.draft.confidence}%)\nApproach: ${d.draft.approach}${d.draft.reasoning ? `\nReasoning: ${d.draft.reasoning}` : ''}${d.draft.tradeoffs?.length ? `\nTradeoffs: ${d.draft.tradeoffs.join('; ')}` : ''}${steps ? `\nSteps:\n${steps}` : ''}`;
    }).join('\n\n');

    // Divergent synthesis must keep the spread visible: collapsing every draft
    // into one merged answer would undo the stances one dispatch later. It still
    // ends with a single recommendation so downstream automation has one
    // decidable answer to act on.
    const expandPrompt = style === 'divergent'
      ? [
          opts.question,
          '',
          `Multiple AI engines analyzed this from deliberately different stances. Here are ALL their drafts:`,
          '',
          allDrafts,
          '',
          'Present the 2-3 strongest DISTINCT directions from the drafts above — including at least one that challenges the framing of the original question. For each direction: the core idea, why it could win, and its main risk.',
          'Then close with a single clear recommendation: which direction to take first and why.',
        ].join('\n')
      : [
          opts.question,
          '',
          `Multiple AI engines analyzed this. Here are ALL their drafts — synthesize the best parts from each into one comprehensive answer:`,
          '',
          allDrafts,
          '',
          'Now write the best possible answer by combining the strongest ideas from ALL drafts above. Don\'t just pick one — take the best parts from each.',
          'Be specific and actionable. Include file paths where relevant.',
        ].join('\n');

    let response: string;
    let synthesis: {status:'completed' | 'fallback', detail?:string};
    try {
      opts.onEvent?.({ type: 'brainstorm:synthesis-started', data: { engineId: winner.engineId } });
      const answerResult = await synthesize(expandPrompt);
      if (answerResult.exitCode !== 0 || !String(answerResult.stdout ?? '').trim()) {
        const detail = answerResult.stderr?.trim()
          ? answerResult.stderr.trim()
          : (!String(answerResult.stdout ?? '').trim() ? 'empty response' : `exit ${answerResult.exitCode}`);
        throw new Error(detail);
      }
      response = answerResult.stdout;
      synthesis = { status: 'completed' };
      opts.onEvent?.({ type: 'brainstorm:synthesis-completed', data: { engineId: winner.engineId, ok: true } });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[agon] brainstorm synthesis (${winner.engineId}) failed: ${error}`);
      synthesis = { status: 'fallback', detail: error };
      opts.onEvent?.({ type: 'brainstorm:synthesis-completed', data: { engineId: winner.engineId, ok: false, detail: error } });
      response = [
        `Brainstorm synthesis failed for ${winner.engineId}: ${error}`,
        '',
        'Raw ranked drafts:',
        allDrafts || '(no draft text)',
      ].join('\n');
    }

    sidechain.log('brainstorm:done', winner.engineId, {
      bids: bids.map((b: BrainstormBid) => ({ engineId: b.engineId, confidence: b.confidence })),
      responseLength: response.length,
    });

    return {
      question: opts.question,
      bids,
      winner: winner.engineId,
      response: response.replace(/<think>[\s\S]*?<\/think>\s*/gi, ''),
      groups: dedup.groups ?? undefined,
      dedup: dedup.status,
      synthesis,
      panelHealth,
    };

  };
}
