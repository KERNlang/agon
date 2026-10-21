import { randomUUID } from 'node:crypto';
import { createSidechainLogger } from '@kernlang/agon-kernel';
import type { EngineAdapter, DispatchResult, TaskClass } from '@kernlang/agon-support-engine-runtime';
import { preflightHealthFilter, dispatchSeatWithRetry, buildPanelHealth } from '@kernlang/agon-support-panel';
import type { PanelEngineRegistry, PanelHealthRuntime, SeatOutcome } from '@kernlang/agon-support-panel';
import { getModeConfig, buildModePrompt, buildModeSummaryPrompt } from './modes.js';
import type { TribunalMode, TribunalProtocol } from './modes.js';

export interface TribunalEvent {
  type: 'synthesis:start' | 'synthesis:critique' | 'engine:failed' | 'forge:done';
  engineId?: string;
  data?: Record<string, unknown>;
}

export interface TribunalRuntimeOptions<Registry extends PanelEngineRegistry = PanelEngineRegistry> {
  question: string;
  engines: string[];
  rounds: number;
  mode?: TribunalMode;
  protocol?: TribunalProtocol;
  registry: Registry;
  adapter: EngineAdapter;
  timeout: number;
  outputDir: string;
  cwd?: string;
  onEvent?: (event: TribunalEvent) => void;
  signal?: AbortSignal;
}

/** Host effects only. Debate policy and execution belong to this mod. */
export interface TribunalRuntimeEffects<Registry extends PanelEngineRegistry> {
  assertCurrent?(): void;
  seedRegistry(registry: Registry): void;
  loadConfig(cwd: string): ReturnType<PanelHealthRuntime['loadConfig']> & { cesarEngine?: string };
  classifyTask(question: string): TaskClass;
  updateRanked(ranked: Array<{ engineId: string; score: number }>, taskClass: TaskClass, mode: 'tribunal' | 'critique'): void;
}

export interface TribunalPosition {
  engineId: string;
  position: string;
  arguments: string[];
}

export interface TribunalRound {
  round: number;
  positions: TribunalPosition[];
}

export interface TribunalResult {
  question: string;
  rounds: TribunalRound[];
  positions: TribunalPosition[];
  summary: string;
  mode?: string;
  protocol?: TribunalProtocol;
  panelHealth?: { requested: number; responded: number; degraded: boolean; notes: string[]; banner: string | null };
}

export function buildFallbackSummary(positions: TribunalPosition[]): string {
  return positions.map((p) => `**${p.engineId} (${p.position})**: ${p.arguments[p.arguments.length - 1]?.slice(0, 200) ?? '(no response)'}...`).join('\n\n');
}

/**
 * Extracts the engine's visible text from a debate-round dispatch. Reasoning-heavy engines (Claude with extended thinking, DeepSeek-R1, o1-class, Kimi reasoning) often emit only internal <think>...</think> when given a single-turn debate prompt. Previous behavior threw on empty-after-strip, degrading the tribunal to '(no response)' placeholders even when the engine actually thought through the question. Now: if stripping leaves nothing but raw output had substantial thinking, surface a truncated thinking excerpt with a clear banner so the debate can continue with real signal.
 */
export function requireNonEmptyDispatchText(result: DispatchResult, phase: string): string {
  const raw = String(result.stdout ?? '').trim();
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
  if (result.timedOut || result.exitCode !== 0) {
    const detail = result.timedOut ? 'timed out' : result.stderr?.trim() || `exit ${result.exitCode}`;
    throw Object.assign(new Error(`${phase} failed: ${detail}`), {
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  if (cleaned.length > 0) return cleaned;

  // Multiple <think> blocks: pick the longest. Some engines emit several
  // short bursts of reasoning; selecting only the first block would still
  // throw if it happened to be a short preamble. matchAll handles all.
  const thinkingBlocks = [...raw.matchAll(/<think>([\s\S]*?)<\/think>/gi)]
    .map((m) => m[1].trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  const thinking = thinkingBlocks[0] ?? '';
  if (thinking.length > 40) {
    const snippet = thinking.slice(0, 800);
    return `[reasoning-only response — engine emitted internal thinking but no visible conclusion]\n\n${snippet}${thinking.length > 800 ? '…' : ''}`;
  }

  throw Object.assign(new Error(`${phase} returned empty response`), {
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

export function createTribunalRuntime<Registry extends PanelEngineRegistry>(effects: TribunalRuntimeEffects<Registry>) {
  return async function runTribunal(opts: TribunalRuntimeOptions<Registry>): Promise<TribunalResult> {
    const { question, rounds, registry, adapter, timeout, outputDir } = opts;
    const cwd = opts.cwd ?? process.cwd();
    const signal = opts.signal;
    const assertCurrent = () => {
      signal?.throwIfAborted();
      effects.assertCurrent?.();
    };
    assertCurrent();
    const mode = opts.mode ?? 'adversarial';
    // Pre-flight: drop engines quarantined this session (auth-failed/unreachable)
    // so a dead engine doesn't burn a panel slot + a full per-engine timeout.
    // Layer 1 is a pure zero-dispatch read; the active probe is opt-in only.
    const __hc = await preflightHealthFilter({ engineIds: opts.engines, registry, adapter, signal, cwd, runtime: { loadConfig: effects.loadConfig } });
    assertCurrent();
    for (const s of __hc.skipped) console.warn(`[agon] tribunal: skipping ${s.engineId} — ${s.status} (${s.reason})`);
    const engines = __hc.healthy;
    if (engines.length < 2) {
      // Distinguish "too few engines provided" from "engines were quarantined" so the
      // message points at the real cause (zai review 0.80).
      if (__hc.skipped.length === 0) {
        throw new Error(`Tribunal needs at least 2 engines; only ${opts.engines.length} provided. Widen --engines or add one with 'agon engine add <id>'.`);
      }
      throw new Error(`Tribunal needs at least 2 healthy engines; ${__hc.skipped.length} were quarantined this session (${__hc.skipped.map((s) => s.engineId).join(', ')}). Restore with 'agon engine add <id>' or widen --engines.`);
    }
    // Cold-start: seed any newly-dropped model version (EngineDefinition.derivedFrom)
    // from its predecessor BEFORE competing, so it enters ranked play at its family's
    // strength rather than the 1500 default.
    effects.seedRegistry(registry);
    const modeConfig = getModeConfig(mode, engines.length);
    const protocol = opts.protocol ?? modeConfig.protocol;

    // Assign roles from mode config
    const roles = modeConfig.roles.slice(0, engines.length);
    // Pad with generic roles if more engines than roles
    while (roles.length < engines.length) {
      roles.push(`Participant ${roles.length + 1}`);
    }

    const positions: TribunalPosition[] = engines.map((id: string, i: number) => ({
      engineId: id,
      position: roles[i],
      arguments: [],
    }));

    const effectiveRounds = Math.min(rounds, modeConfig.maxRounds);

    // Sidechain audit trail
    const tribunalId = randomUUID().slice(0, 8);
    const sidechain = createSidechainLogger({
      sessionId: tribunalId,
      sessionType: 'tribunal',
      outputDir,
    });
    sidechain.log('tribunal:init', undefined, { question, mode, protocol, engines, rounds: effectiveRounds });
    const allRounds: TribunalRound[] = [];
    // One SeatOutcome per engine-round; folded into panelHealth at the end so a
    // seat that flaked (or was rescued by the auto-retry) is reported loudly.
    const seatOutcomes: SeatOutcome[] = [];

    for (let round = 1; round <= effectiveRounds; round++) {
      // Doppelganger fix: respect cancellation between rounds. Without
      // this the tribunal runs to completion even after the user cancels.
      if (signal?.aborted) {
        sidechain.log('tribunal:aborted', undefined, { round });
        signal.throwIfAborted();
      }
      opts.onEvent?.({
        type: 'synthesis:start',
        data: { round, totalRounds: effectiveRounds, mode, protocol },
      });

      const prevArgs = round > 1
        ? positions
            .map((p) => `**${p.engineId} (${p.position}):**\n${p.arguments[p.arguments.length - 1]}`)
            .join('\n\n---\n\n')
        : undefined;

      const dispatchPosition = async (pos: TribunalPosition, currentRoundArguments?: string) => {
        assertCurrent();
        const engine = registry.get(pos.engineId);
        const prompt = buildModePrompt({
          mode,
          role: pos.position,
          question,
          round,
          totalRounds: effectiveRounds,
          previousArguments: prevArgs,
          currentRoundArguments,
        });

        opts.onEvent?.({
          type: 'synthesis:critique',
          engineId: pos.engineId,
          data: { round, position: pos.position, mode, protocol },
        });

        // One auto-retry per seat-round (shorter timeout); the engine's own
        // text-extraction (<think> salvage) runs inside each attempt via extract.
        const seat = await dispatchSeatWithRetry(adapter, {
          engineId: `${pos.engineId} r${round}`,
          engine,
          prompt,
          systemPrompt: 'You are a debate participant. Respond directly with your argument as plain text. Do NOT use tools, read files, or run commands.',
          textOnly: true,
          cwd,
          mode: 'exec',
          timeout,
          outputDir,
          signal,
          extract: (result) => requireNonEmptyDispatchText(result, `tribunal ${pos.engineId} round ${round}`),
        });
        assertCurrent();
        seatOutcomes.push(seat);
        if (!seat.ok) {
          // Keep the underlying stderr/message in the event + warn line — the
          // CLI's "Engines that hit errors" section must stay diagnosable, not
          // collapse to a bare 'timeout'/'error' category.
          const errDetail = seat.detail ? `${seat.failure}: ${seat.detail}` : (seat.failure ?? 'failed');
          console.warn(`[agon] tribunal dispatch (${pos.engineId}) round ${round} failed after ${seat.attempts} attempt(s): ${errDetail}`);
          opts.onEvent?.({ type: 'engine:failed', engineId: pos.engineId, data: { engineId: pos.engineId, phase: `tribunal-round-${round}`, error: errDetail } });
          return { engineId: pos.engineId, argument: '(failed to respond)' };
        }
        return { engineId: pos.engineId, argument: seat.text };
      };

      let roundResults: { engineId: string; argument: string }[];
      const runInParallel = protocol === 'parallel' || (protocol === 'hybrid' && round === 1);
      if (runInParallel) {
        // Drain started seats before the caller can dispose of workflow resources.
        const outcomes = await Promise.allSettled(positions.map((pos) => dispatchPosition(pos)));
        roundResults = outcomes.map(outcome => {
          if (outcome.status === 'rejected') throw outcome.reason;
          return outcome.value;
        });
      } else {
        roundResults = [];
        for (const pos of positions) {
          signal?.throwIfAborted();
          const currentRoundArguments = roundResults.length > 0
            ? roundResults
                .map((result) => {
                  const prior = positions.find((candidate) => candidate.engineId === result.engineId);
                  return `**${result.engineId} (${prior?.position ?? 'Participant'}):**\n${result.argument}`;
                })
                .join('\n\n---\n\n')
            : undefined;
          roundResults.push(await dispatchPosition(pos, currentRoundArguments));
        }
      }

      assertCurrent();
      for (const result of roundResults) {
        const pos = positions.find((p) => p.engineId === result.engineId);
        if (pos) pos.arguments.push(result.argument);
        sidechain.log('round:response', result.engineId, { round, argLength: result.argument.length });
      }

      allRounds.push({
        round,
        positions: positions.map((p) => ({
          ...p,
          arguments: [p.arguments[p.arguments.length - 1]],
        })),
      });
    }

    assertCurrent();
    // Summary using the configured Cesar engine when available, else first engine
    let summaryEngine;
    try {
      const cesarId = effects.loadConfig(cwd).cesarEngine ?? 'claude';
      summaryEngine = registry.get(cesarId);
    } catch {
      assertCurrent();
      summaryEngine = registry.get(engines[0]);
    }
    const summaryPrompt = buildModeSummaryPrompt({ mode, question, positions });

    let summary: string;
    try {
      const summaryResult = await adapter.dispatch({
        engine: summaryEngine,
        prompt: summaryPrompt,
        systemPrompt: 'You are synthesizing a debate. Respond directly with your verdict as plain text. Do NOT use tools, read files, or run commands.',
        textOnly: true,
        cwd,
        mode: 'exec',
        timeout,
        outputDir,
        signal,
      });
      assertCurrent();
      summary = requireNonEmptyDispatchText(summaryResult, 'tribunal summary');
    } catch (err) {
      assertCurrent();
      const message = err instanceof Error ? err.message : String(err);
      const snippet = (err as any)?.stdout
        ? String((err as any).stdout).slice(0, 200).replace(/\s+/g, ' ').trim()
        : (err as any)?.stderr
          ? String((err as any).stderr).slice(0, 200).replace(/\s+/g, ' ').trim()
          : '';
      const detail = snippet ? `${message} | snippet: ${snippet}${(err as any)?.stdout?.length > 200 || (err as any)?.stderr?.length > 200 ? '…' : ''}` : message;
      console.warn(`[agon] tribunal summary failed: ${detail}`);
      opts.onEvent?.({ type: 'engine:failed', engineId: summaryEngine?.id ?? engines[0], data: { engineId: summaryEngine?.id ?? engines[0], phase: 'tribunal-summary', error: detail } });
      summary = buildFallbackSummary(positions);
    }

    const panelHealth = buildPanelHealth(seatOutcomes);
    if (panelHealth.banner) console.warn(`[agon] tribunal ${panelHealth.banner}`);

    // Update Glicko-2 ratings — score by per-round substantive credit (not raw length)
    if (positions.length >= 2) {
      assertCurrent();
      const taskClass = effects.classifyTask(question);
      const tribunalRanked = positions
        .map((p: any) => {
          const substantive = p.arguments.filter((a: string) => a.length > 20 && a !== '(failed to respond)');
          const roundCredit = substantive.length;
          const cappedAvg = roundCredit > 0
            ? substantive.reduce((sum: number, a: string) => sum + Math.min(a.length, 2000), 0) / roundCredit
            : 0;
          return { engineId: p.engineId, score: roundCredit * 1000 + Math.min(cappedAvg, 2000) };
        })
        .sort((a: any, b: any) => b.score - a.score);
      assertCurrent();
      effects.updateRanked(tribunalRanked, taskClass, 'tribunal');
      // Adversarial / red-team tribunals ARE critique competitions (attack + refute),
      // so feed the same ranking into the 'critique' discipline that Nero selects on.
      if (mode === 'adversarial' || mode === 'red-team') {
        assertCurrent();
        effects.updateRanked(tribunalRanked, taskClass, 'critique');
      }
    }

    assertCurrent();
    sidechain.log('tribunal:done', undefined, {
      rounds: allRounds.length,
      engines: engines.length,
      mode,
      protocol,
      summaryLength: summary.length,
      panelHealth,
    });

    // Publish completion after all effects. The observer cannot cancel completed work.
    opts.onEvent?.({
      type: 'forge:done',
      data: { rounds: allRounds.length, engines: engines.length, mode, protocol },
    });

    return { question, rounds: allRounds, positions, summary, mode, protocol, panelHealth };
  }
}
