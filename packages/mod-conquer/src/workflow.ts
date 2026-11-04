import { buildConquerSystemPrompt, parseBuilderSignals } from './completion-policy.js';

/**
 * Builder permission-request kinds whose blast radius ESCAPES the worktree (un-spendable tokens, remote/CI state, global package installs). Cesar never auto-approves these even inside isolation — they need a human or an explicit gate. The worktree contains git, not the environment.
 */
export const ESCAPING_OPS: readonly string[] = ['push', 'force-push', 'publish', 'deploy', 'network-install', 'merge'] as const;

/**
 * A builder turn line beginning with this token claims completion → triggers the done-oracle.
 */
export const DONE_SENTINEL: string = "CONQUER_DONE";

/**
 * A builder turn line `CONQUER_ASK: <question>` is a fork the builder wants Cesar to resolve via a consult.
 */
export const ASK_SENTINEL: string = "CONQUER_ASK";

export interface StuckSignals {
  costVelocityFlat: boolean;
  diffEntropyLow: boolean;
  outputRepetition: boolean;
  sameFailureSignature: boolean;
  noPlanProgress: boolean;
}

/**
 * The stuck/fork escalation ladder — cheap by default, escalate only on a genuine fork. high-stakes OR explicitly irreversible -> council; a concrete choice between >=2 named options -> tribunal; open-ended 'how do I even start' ideation -> brainstorm; otherwise (a quick is-this-approach-wrong) -> nero. Pure — exported for testing. Mirrors the design's cost ladder so a flaky builder doesn't spawn a 6-engine council on every hiccup.
 */
export function pickEscalationMode(fork: { kind: 'approach-doubt' | 'choice' | 'ideation' | 'high-stakes'; optionCount?: number; reversible?: boolean }): 'nero' | 'tribunal' | 'brainstorm' | 'council' {
  if (fork.kind === 'high-stakes' || fork.reversible === false) return 'council';
  if (fork.kind === 'choice' || (fork.optionCount ?? 0) >= 2) return 'tribunal';
  if (fork.kind === 'ideation') return 'brainstorm';
  return 'nero';
}

/**
 * The builder is 'stuck' when at least `threshold` (default 2) independent stuck signals fire. Single signals false-positive (diff-entropy spikes on a wide refactor that moves nothing; goes flat on a surgical one-line fix), so we require corroboration. Pure — exported for testing.
 */
export function classifyStuck(signals: StuckSignals, threshold?: number): boolean {
  const flags = [
    signals.costVelocityFlat,
    signals.diffEntropyLow,
    signals.outputRepetition,
    signals.sameFailureSignature,
    signals.noPlanProgress,
  ];
  const fired = flags.filter(Boolean).length;
  return fired >= (threshold ?? 2);
}

/**
 * Gate before convening a (costly) consult: escalate ONLY when the builder is both stuck AND has diverged from the held plan. Stuck-but-on-plan = let it keep grinding; on-plan churn must not burn council budget. Pure — exported for testing.
 */
export function shouldEscalate(stuck: boolean, planDiverged: boolean): boolean {
  return stuck && planDiverged;
}

/**
 * Cesar auto-approves the builder's permission requests ONLY inside an isolated worktree, and NEVER for ops whose blast radius escapes it (see ESCAPING_OPS). Outside isolation, nothing is auto-approved — that is the whole reason conquer runs in a worktree. Pure — exported for testing.
 */
export function shouldAutoApprove(req: { kind: string }, worktreeIsolated: boolean): boolean {
  if (!worktreeIsolated) return false;
  return !ESCAPING_OPS.includes(req.kind);
}

/**
 * Compact the verbose output of a Cesar-convened consult (nero/tribunal/brainstorm/council) into a single feed-back turn for the builder — verdict + confidence only, whitespace-collapsed and truncated. Keeps the builder's context lean; the full deliberation lives in the run dir, not the builder's window. Pure — exported for testing.
 */
export function summarizeConsultForBuilder(consult: { mode: string; verdict: string; confidence?: number | null }, maxChars?: number): string {
  const cap = maxChars ?? 600;
  const v = consult.verdict.trim().replace(/\s+/g, ' ');
  const body = v.length > cap ? v.slice(0, cap).trimEnd() + '…' : v;
  const conf = consult.confidence != null ? ` (confidence ${consult.confidence}%)` : '';
  return `[Cesar consulted ${consult.mode}]${conf} ${body}`;
}

/**
 * Branches an unattended conquer --push must never land on. Overridable via config protectedPushBranches.
 */
export const DEFAULT_PROTECTED_PUSH_BRANCHES: string[] = ['main', 'master'];

/**
 * Guard for the unattended --push path (agy review follow-up): a conquer run normally pushes its own isolated conquer/<slug> branch, but if the worktree HEAD ever resolves to a protected branch (builder switched branches, odd isolation state) the push is refused rather than landing an unreviewed build on main. protectedPushBranches (string[]) in config overrides the default ['main','master'] ONLY when non-empty — an empty/absent list means 'use the defaults', never 'protect nothing' (DEFAULT_AGON_CONFIG carries [] for an unset optional array, so an empty-array-disables rule would silently kill the guard for every real loadConfig() caller — 5/6-engine review consensus). Matching is exact after trim, case-insensitive; an empty/unresolvable branch name is protected (fail-closed). Pure — exported for testing.
 */
export function isProtectedPushBranch(branch: string, config?: any): boolean {
  const name = String(branch ?? '').trim().toLowerCase();
  if (!name) return true;
  const raw = Array.isArray(config?.protectedPushBranches)
    ? config.protectedPushBranches.map((b: unknown) => String(b).trim().toLowerCase()).filter(Boolean)
    : [];
  const configured = raw.length > 0 ? raw : DEFAULT_PROTECTED_PUSH_BRANCHES;
  return configured.includes(name);
}

export interface ConquerCaps {
  maxTurns: number;
  maxWallClockMs: number;
}

export interface ConquerState {
  turn: number;
  spentUsd: number;
  startedAtMs: number;
  consults: number;
}

export interface ConquerTurn {
  n: number;
  engineId: string;
  action: 'build' | 'consult' | 'done-check' | 'stop';
  detail: string;
}

export interface ConquerResult {
  ok: boolean;
  task: string;
  turnsUsed: number;
  consultsRun: number;
  done: boolean;
  stopReason: 'done' | 'cap-turns' | 'cap-time' | 'aborted' | 'builder-failed';
  lastClaim: string;
  doneReason: string;
  transcript: string[];
  outputDir: string;
  attackText: string;
  counterexample: string;
  observed: string;
}

export interface ConquerWorkflowOptions {
  task: string;
  builderEngine: string;
  outputDir: string;
  caps?: ConquerCaps;
  onTurn?: (turn: ConquerTurn) => void;
  signal?: AbortSignal;
}

export interface ConquerWorkflowEffects {
  contextSpine(): Promise<string>;
  build(prompt: string, systemPrompt: string): Promise<{
    stdout?: string; stderr?: string; exitCode?: number; timedOut?: boolean;
  }>;
  consult(mode: 'nero' | 'tribunal' | 'brainstorm' | 'council', question: string): Promise<{
    mode: string; verdict: string; confidence: number | null; flawed: boolean;
  }>;
  evaluateDone(claim: string): Promise<{
    passed: boolean; reason: string; falsified: boolean; aborted?: boolean;
    attackText: string; counterexample: string | null; observed: string | null;
  }>;
}

/**
 * Pure cap check: the run stops when it has used maxTurns or exceeded maxWallClockMs (0 = no wall-clock cap). Budget-USD is intentionally NOT enforced here — DispatchResult carries token usage, not price, so spend is best-effort until a cost-bearing result exists. Pure — exported for testing.
 */
export function capBreached(state: ConquerState, caps: ConquerCaps, nowMs: number): '' | 'cap-turns' | 'cap-time' {
  if (state.turn >= caps.maxTurns) return 'cap-turns';
  if (caps.maxWallClockMs > 0 && (nowMs - state.startedAtMs) >= caps.maxWallClockMs) return 'cap-time';
  return '';
}


/**
 * Heuristically classify a builder ASK into a fork kind so pickEscalationMode can route it: high-stakes cues (irreversible/schema/security/architecture) -> high-stakes; >=2 enumerated options -> choice; open 'how/where do I' phrasing -> ideation; else approach-doubt. Pure — exported for testing.
 */
export function classifyAsk(ask: string): { kind: 'approach-doubt' | 'choice' | 'ideation' | 'high-stakes'; optionCount: number } {
  const lower = ask.toLowerCase();
  const optMatches = ask.match(/(?:^|\s)(?:\d+[.)]|[a-d][.)]|\bor\b)/gi);
  const optionCount = optMatches ? optMatches.length : 0;
  if (/\b(irreversible|delete|drop|migrat|schema|breaking|security|architect)\w*/.test(lower)) return { kind: 'high-stakes', optionCount };
  if (optionCount >= 2) return { kind: 'choice', optionCount };
  if (/\b(how (do|should|to)|where (do|to)|no idea|not sure how|approach to)\b/.test(lower)) return { kind: 'ideation', optionCount };
  return { kind: 'approach-doubt', optionCount };
}


/**
 * Build a bounded supervisor envelope for every builder turn. The original task is repeated verbatim on every dispatch, while only recent state and a capped previous output are carried forward so a long run neither loses its objective nor grows prompt context without bound.
 */
export function buildConquerTurnPrompt(opts: {task:string, turn:number, kernSpine?:string, previousOutput?:string, instruction:string, transcript?:string[]}): string {
  const recentState = (opts.transcript ?? []).slice(-6).join('\n') || '(first turn)';
  const previous = String(opts.previousOutput ?? '');
  const cappedPrevious = previous.length > 6_000
    ? `[... ${previous.length - 6_000} earlier chars omitted]\n${previous.slice(-6_000)}`
    : previous;
  const sections = [
    '## CONQUER ORIGINAL TASK (authoritative; keep working toward this exact request)',
    opts.task,
    '',
    `## SUPERVISOR STATE (turn ${opts.turn})`,
    recentState,
  ];
  if (opts.turn === 1 && opts.kernSpine) sections.push('', opts.kernSpine);
  if (cappedPrevious) sections.push('', '## PREVIOUS BUILDER OUTPUT', cappedPrevious);
  sections.push('', '## CESAR INSTRUCTION', opts.instruction);
  return sections.join('\n');
}

/**
 * The supervised-autonomous build loop. Drives the builder engine in agent mode turn-by-turn; on a CONQUER_ASK fork, classifies it and convenes the cheapest sufficient consult (nero→tribunal→brainstorm→council), feeding back a compact verdict; on a CONQUER_DONE claim, runs the done-oracle via the injected evaluateDone seam (the caller computes diff/gate/oracle in the worktree). Stops on done, a turn/wall-clock cap, abort, or builder failure. Auto-approve + worktree isolation + the human merge gate live in the CLI surface. Composes the injected adapter + the agon mode runners; no environment ops here (kept testable).
 */
export async function runConquerWorkflow(opts: ConquerWorkflowOptions, effects: ConquerWorkflowEffects): Promise<ConquerResult> {
  const caps = opts.caps ?? { maxTurns: 40, maxWallClockMs: 0 };
  const sys = buildConquerSystemPrompt();
  const transcript: string[] = [];
  const state: ConquerState = { turn: 0, spentUsd: 0, startedAtMs: Date.now(), consults: 0 };

  // Conquer builds its own builder prompt (it does NOT route through runForge).
  // The project spine is injected on turn one; the original task is repeated
  // verbatim on EVERY turn by buildConquerTurnPrompt so supervisor feedback
  // cannot accidentally replace the actual objective.
  // Best-effort + memoized per cwd; '' for non-TS targets or if the CLI is absent.
  const kernSpine = await effects.contextSpine();
  let previousOutput = '';
  let instruction = 'Begin the task. Work autonomously until you need a real decision or can make a verified done claim.';
  let done = false;
  let lastClaim = '';
  let doneReason = '';
  let lastAttackText = '';
  let lastCounterexample = '';
  let lastObserved = '';
  let stopReason: 'done' | 'cap-turns' | 'cap-time' | 'aborted' | 'builder-failed' = 'cap-turns';

  const emit = (n: number, action: 'build' | 'consult' | 'done-check' | 'stop', detail: string): void => {
    transcript.push(`[turn ${n}] ${action}: ${detail.slice(0, 240)}`);
    opts.onTurn?.({ n, engineId: opts.builderEngine, action, detail });
  };

  while (true) {
    if (opts.signal?.aborted) { stopReason = 'aborted'; break; }
    const breach = capBreached(state, caps, Date.now());
    if (breach) { stopReason = breach; break; }
    state.turn += 1;

    const prompt = buildConquerTurnPrompt({
      task: opts.task,
      turn: state.turn,
      kernSpine,
      previousOutput,
      instruction,
      transcript,
    });

    const res = await effects.build(prompt, sys);
    if (opts.signal?.aborted) { stopReason = 'aborted'; break; }
    const out = String(res?.stdout ?? '').trim();
    // A timed-out or non-zero-exit builder turn is a failure even with partial stdout —
    // feeding garbage back would burn the whole turn budget. Capture diagnostics + stop.
    if (res?.timedOut === true || (res?.exitCode ?? 0) !== 0) {
      const why = res?.timedOut === true
        ? 'builder timed out'
        : `builder dispatch failed (exit ${res?.exitCode})${res?.stderr ? `: ${String(res.stderr).slice(0, 200)}` : ''}`;
      emit(state.turn, 'stop', why);
      stopReason = 'builder-failed';
      break;
    }
    emit(state.turn, 'build', out);
    previousOutput = out;

    const sig = parseBuilderSignals(out);

    if (sig.claimedDone) {
      lastClaim = sig.claim;
      const verdict = await effects.evaluateDone(sig.claim);
      doneReason = verdict.reason;
      lastAttackText = verdict.attackText;
      lastCounterexample = verdict.counterexample ?? '';
      lastObserved = verdict.observed ?? '';
      emit(state.turn, 'done-check', verdict.reason);
      if (opts.signal?.aborted || verdict.aborted) { stopReason = 'aborted'; break; }
      if (verdict.passed) { done = true; stopReason = 'done'; break; }
      // Feed back the VERIFIED counterexample (only when the re-run actually
      // reproduced — falsified) so the builder targets the exact failure. A rejected/
      // advisory counterexample is left for the human gate, not pitched as reproduced.
      const ce = verdict.falsified && verdict.counterexample
        ? ` A falsifier reproduced a failure: \`${verdict.counterexample}\`${verdict.observed ? ` → observed: ${verdict.observed}` : ''}.`
        : '';
      instruction = `[Cesar] Not done yet — ${verdict.reason}.${ce} Fix it and continue; re-emit CONQUER_DONE when the gate is green.`;
      continue;
    }

    if (sig.ask !== null) {
      const fork = classifyAsk(sig.ask);
      const mode = pickEscalationMode(fork);
      const consult = await effects.consult(mode, sig.ask);
      state.consults += 1;
      emit(state.turn, 'consult', `${mode}: ${consult.verdict.slice(0, 120)}`);
      instruction = `${summarizeConsultForBuilder(consult)}\n\nContinue. Emit CONQUER_ASK only for a real fork, CONQUER_DONE when finished.`;
      continue;
    }

    // No sentinel — nudge and keep building.
    instruction = '[Cesar] Continue. Emit "CONQUER_ASK: <question>" if you hit a fork, "CONQUER_DONE: <claim>" when finished and tests pass.';
  }

  return {
    ok: done, task: opts.task, turnsUsed: state.turn, consultsRun: state.consults,
    done, stopReason, lastClaim, doneReason, transcript, outputDir: opts.outputDir,
    attackText: lastAttackText, counterexample: lastCounterexample, observed: lastObserved,
  };
}
