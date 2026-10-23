import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import { preflightHealthFilter } from '@kernlang/agon-support-panel';
import type { PanelEngineRegistry, PanelHealthRuntime } from '@kernlang/agon-support-panel';

export interface CampfireResult {
  topic: string;
  rounds: {engineId:string,content:string}[];
}

export interface CampfireOptions {
  topic: string;
  context?: string;
  engines: string[];
  registry: PanelEngineRegistry;
  adapter: EngineAdapter;
  strategy: 'lead-first' | 'all-respond';
  leadEngine?: string;
  seedPlan?: string;
  timeout: number;
  outputDir: string;
  cwd: string;
  signal?: AbortSignal;
}

export interface CampfireEffects extends PanelHealthRuntime {
  assertCurrent?(): void;
  warn(message: string): void;
}

export async function runCampfireRuntime(opts: CampfireOptions, effects: CampfireEffects): Promise<CampfireResult & { lead: string }> {
  const controller = new AbortController();
  const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
  const assertCurrent = () => {
    try { signal.throwIfAborted(); effects.assertCurrent?.(); }
    catch (error) { controller.abort(error); throw error; }
  };
  const settleSeats = async (seats: Promise<void>[]) => {
    const settled = await Promise.allSettled(seats);
    assertCurrent();
    const rejected = settled.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
  };
  assertCurrent();
  const { topic, registry, adapter, strategy, timeout, outputDir } = opts;
  const cwd = opts.cwd;
  // Pre-flight: drop session-quarantined engines (Layer 1, pure zero-dispatch). Probe opt-in.
  const __hc = await preflightHealthFilter({ engineIds: opts.engines, registry, adapter, signal, cwd, runtime: effects });
  assertCurrent();
  for (const s of __hc.skipped) effects.warn(`[agon] campfire: skipping ${s.engineId} — ${s.status} (${s.reason})`);
  const engines = __hc.healthy;
  if (engines.length === 0) {
    throw new Error(`No healthy engines for campfire; all ${__hc.skipped.length} were quarantined this session (${__hc.skipped.map((s) => s.engineId).join(', ')}). Restore with 'agon engine add <id>'.`);
  }

  const basePrompt = [
    `## CAMPFIRE`,
    `Topic: ${topic || 'open discussion'}`,
    '',
    opts.context ? `## Project Context\n${opts.context}\n` : '',
    opts.seedPlan ? `## Lead assessment (prior context)\n${opts.seedPlan}\n` : '',
    `## Rules`,
    `This is a campfire — no competition, no ranking, no winners.`,
    `Think freely. Share ideas, wild thoughts, "what if" scenarios.`,
    `Be honest. Say "I'm not sure" if you're not sure.`,
    `Build on the topic. Be interesting, not just useful.`,
    `Keep it concise — 3-5 paragraphs max.`,
  ].filter(Boolean).join('\n');

  const rounds: { engineId: string; content: string }[] = [];
  const leadId = opts.leadEngine && engines.includes(opts.leadEngine) ? opts.leadEngine : engines[0];

  if (strategy === 'lead-first' && engines.length > 1) {
    // Lead-first: dispatch lead engine, then observers with lead's response
    assertCurrent();
    const leadEngine = registry.get(leadId);
    let leadResponse = '';

    try {
      const leadResult = await adapter.dispatch({
        engine: leadEngine,
        prompt: basePrompt,
        systemPrompt: 'You are in a campfire conversation. Respond directly with your thoughts as plain text. Do NOT use tools, read files, or run commands.',
        textOnly: true,
        cwd,
        mode: 'exec',
        timeout,
        outputDir,
        signal,
      });
      assertCurrent();
      leadResponse = leadResult.stdout.trim();
      rounds.push({ engineId: leadId, content: leadResponse });
    } catch (err) {
      assertCurrent();
      effects.warn(`[agon] campfire lead dispatch (${leadId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (leadResponse && !signal.aborted) {
      const observerPrompt = [
        basePrompt,
        '',
        `## Lead engine (${leadId}) response`,
        leadResponse,
        '',
        `## Your role`,
        `The lead engine proposed the above. Only respond if you have a substantively different perspective or disagree. If you mostly agree, respond with just "Agree" or stay brief.`,
      ].join('\n');

      const observers = engines.filter((id: string) => id !== leadId);
      const observerDone = observers.map(async (engineId: string) => {
        assertCurrent();
        const engine = registry.get(engineId);
        try {
          const result = await adapter.dispatch({
            engine,
            prompt: observerPrompt,
            systemPrompt: 'You are in a campfire conversation. Respond directly with your thoughts as plain text. Do NOT use tools, read files, or run commands.',
            textOnly: true,
            cwd,
            mode: 'exec',
            timeout,
            outputDir,
            signal,
          });
          assertCurrent();
          const response = result.stdout.trim();
          // Skip near-empty or pure agreement responses
          if (response && response.length > 20 && !/^agree\b/i.test(response)) {
            rounds.push({ engineId, content: response });
          }
        } catch (err) {
          assertCurrent();
          effects.warn(`[agon] campfire observer (${engineId}) failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      await settleSeats(observerDone);
    }
  } else {
    // All-respond: parallel dispatch to all engines
    const allDone = engines.map(async (engineId: string) => {
      assertCurrent();
      const engine = registry.get(engineId);
      try {
        const result = await adapter.dispatch({
          engine,
          prompt: basePrompt,
          systemPrompt: 'You are in a campfire conversation. Respond directly with your thoughts as plain text. Do NOT use tools, read files, or run commands.',
          textOnly: true,
          cwd,
          mode: 'exec',
          timeout,
          outputDir,
          signal,
        });
        assertCurrent();
        rounds.push({ engineId, content: result.stdout.trim() });
      } catch (err) {
        assertCurrent();
        effects.warn(`[agon] campfire dispatch (${engineId}) failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    await settleSeats(allDone);
  }

  assertCurrent();
  return { topic: topic || 'open discussion', rounds, lead: leadId };
}
