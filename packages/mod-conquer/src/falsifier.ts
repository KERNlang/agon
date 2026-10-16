import { join, dirname, relative, resolve, sep } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawnWithTimeout } from '@kernlang/agon-support-engine-runtime';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import { parseNeroVerdict } from '@kernlang/agon-mod-nero';
import { evaluateDoneEvidence } from './completion-policy.js';

export interface FalsifierOptions {
  claim: string;
  gate?: string;
  cwd: string;
  engines: string[];
  timeout: number;
  outputDir: string;
  signal?: AbortSignal;
  sandbox?: SandboxOps;
}

/** The host supplies catalog and ranking access, not verification policy. */
export interface FalsifierEffects {
  assertCurrent?(): void;
  rankCritics(engineIds: string[]): readonly { engineId: string }[];
  getEngine(engineId: string): EngineDefinition;
  adapter: Pick<EngineAdapter, 'dispatchAgent'>;
}

export interface DoneOracleOptions extends FalsifierOptions {
  diff: string;
  gateOk: boolean;
  oracleTampered: boolean;
}

export interface SandboxOps {
  clone: (src: string, dest: string, signal?: AbortSignal) => Promise<boolean>;
  exec: (cmd: string, cwd: string, timeoutMs: number, signal?: AbortSignal) => Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>;
  remove: (dir: string) => Promise<void>;
}

export interface FalsifierResult {
  falsified: boolean;
  counterexample: string | null;
  observed: string | null;
  attackText: string;
  critic: string;
  advisoryOnly: boolean;
  note: string;
  verification?: Awaited<ReturnType<SandboxOps['exec']>>;
}

export interface DoneOracleResult extends FalsifierResult {
  passed: boolean;
  reason: string;
}

/**
 * True when an engine can act as a TOOL-ENABLED agent critic in the done-falsifier — i.e. it has a real CLI binary that supports agent mode (codex/claude/agy/aider). API-only coding-plan engines (kimi/minimax/zai) have no binary and no agent-mode config, so they cannot reliably read code + run commands in the sandbox; the falsifier skips them and falls back to advisory. Pure — exported for testing. (FOLLOW-UP: an explicit `agentCapable` flag on EngineDefinition would beat this structural inference.)
 */
export function isAgentCapableEngine(engine: { binary?: string; agent?: unknown; modes?: readonly string[] }): boolean {
  if (!engine || !engine.binary) return false;
  if (engine.agent) return true;
  return Array.isArray(engine.modes) && engine.modes.includes('agent');
}

/**
 * Build the tool-enabled falsifier prompt. Unlike the tool-LESS nero prompt, it grants full sandbox tool access and DEMANDS a self-asserting, re-runnable counterexample (exit non-zero iff the bug is present) so the verdict can be mechanically verified rather than trusted. Pure — exported for testing.
 */
export function buildFalsifierPrompt(opts: { claim:string; gate?:string }): string {
  const lines: string[] = [];
  lines.push('You are a falsification critic with FULL tool access to this repository — a disposable sandbox copy. You may read any file and run any shell command.');
  lines.push('');
  lines.push('A build agent claims its work is complete:');
  lines.push(`CLAIM: ${opts.claim.trim()}`);
  if (opts.gate && opts.gate.trim()) {
    lines.push('');
    lines.push(`The project's acceptance gate (what "passing" means) is: ${opts.gate.trim()}`);
  }
  lines.push('');
  lines.push('Your job: try to BREAK the claim. Inspect the ACTUAL code and RUN commands to find a concrete case where behavior is wrong, or where the gate is gameable (passes despite broken behavior). Do NOT speculate — verify every failure by actually running it first.');
  lines.push('The counterexample must be self-contained. Inline any reproduction script or fixture setup in the command. Files you create while investigating are not copied into the clean verification tree. A missing reproduction input is not proof of the claimed bug.');
  lines.push('');
  lines.push('If — and ONLY if — you reproduce a real failure, end your reply with EXACTLY these three lines:');
  lines.push('COUNTEREXAMPLE: <one shell command that EXITS NON-ZERO if and only if the bug is present — write it as a self-checking assertion (wrap the check in `test`, `grep -q`, a one-line `python -c "assert ..."`, or chain `&&`/`||`). It will be re-run VERBATIM in a clean copy of this repo; if it exits zero, your counterexample is REJECTED and the claim is treated as not-yet-broken.>');
  lines.push('OBSERVED: <the wrong output or behavior you actually saw>');
  lines.push('VERDICT: FLAWED');
  lines.push('');
  lines.push('If you tried and could NOT break it, end with exactly:');
  lines.push('VERDICT: SOUND');
  return lines.join('\n');
}

/**
 * Parse a done-falsifier reply: the LAST COUNTEREXAMPLE: line (the runnable command), the LAST OBSERVED: line, and the verdict (via parseNeroVerdict — last VERDICT: marker wins). Tolerant of casing + surrounding whitespace. Pure — exported for testing.
 */
export function parseFalsifierOutput(text: string): { counterexample: string | null; observed: string | null; verdict: 'flawed' | 'proceed-with-caution' | 'sound' | 'unknown' } {
  const ceMatches = [...text.matchAll(/^[ \t]*COUNTEREXAMPLE:[ \t]*(.+?)[ \t]*$/gim)];
  const obMatches = [...text.matchAll(/^[ \t]*OBSERVED:[ \t]*(.+?)[ \t]*$/gim)];
  const ce = ceMatches.length ? ceMatches[ceMatches.length - 1][1].trim() : '';
  const ob = obMatches.length ? obMatches[obMatches.length - 1][1].trim() : '';
  return { counterexample: ce.length ? ce : null, observed: ob.length ? ob : null, verdict: parseNeroVerdict(text) };
}

/**
 * Defence-in-depth gate on the LLM-proposed counterexample before AUTO-EXECUTING it (codex/minimax review, blocking). Even inside the CoW sandbox, `sh -c` would otherwise let a confused/hallucinating critic escape to the wider filesystem or network. Rejects the catastrophic patterns a legitimate self-asserting behavioural check NEVER needs — privilege escalation, recursive force-deletes, fork bombs, device/disk clobber, host control, network/exfil tools, recursive perm changes, remote git mutation, and write-redirects into absolute system dirs. A rejected counterexample is NOT executed → treated as advisory (surfaced to the human), erring safe. Pairs with HOME/TMPDIR confinement + the CoW sandbox + the gate-green precondition. Returns true = safe to run. Pure — exported for testing. (FOLLOW-UP: real OS/container confinement — sandbox-exec/bwrap with denied network — for untrusted tasks; this denylist + env-confinement is the v1 floor.)
 */
export function isSafeCounterexample(cmd: string): boolean {
  const c = cmd.toLowerCase();
  const danger: RegExp[] = [
    /\bsudo\b|\bdoas\b|\bsu\s+-/,                              // privilege escalation
    /\brm\s+-[a-z]*r[a-z]*f\b|\brm\s+-[a-z]*f[a-z]*r\b/,        // recursive force delete
    /:\s*\(\s*\)\s*\{/,                                         // fork bomb :(){
    /\bmkfs\b|\bdd\b[^|&;]*\bof=|>\s*\/dev\//,                  // disk / device clobber
    /\b(shutdown|reboot|halt|poweroff|killall)\b/,             // host control
    /\b(curl|wget|nc|ncat|telnet|ssh|scp|sftp)\b/,             // network / exfil tools
    /\bchmod\s+-[a-z]*r\b|\bchown\s+-[a-z]*r\b/,               // recursive perm change
    /\bgit\s+push\b/,                                           // remote mutation
    />>?\s*\/(etc|usr|bin|sbin|var|system|library|opt)\b/,     // write-redirect to abs system dirs
  ];
  return !danger.some((re) => re.test(c));
}

/** Recognize a reported input that existed only in the critic's copy. */
function missingCriticInput(stderr: string, criticDir: string, verificationDir: string): string | undefined {
  if (!existsSync(verificationDir)) return;
  const root = realpathSync(verificationDir);
  for (const line of stderr.split('\n')) {
    if (!/cannot find module|can't open file|no such file or directory|not found/i.test(line)) continue;
    for (const match of line.matchAll(/(?:^|\s)(['"])([^'"\r\n]+)\1/g)) {
      const candidate = resolve(root, match[2]);
      const path = relative(root, candidate);
      if (!path || path === '..' || path.startsWith(`..${sep}`)) continue;
      if (!existsSync(candidate) && existsSync(join(criticDir, path))) return path;
    }
  }
}

/**
 * The L4/L5 done-oracle: an EVIDENCE-BASED, mechanically-verified falsifier. (1) Pick the top-rated AGENT-CAPABLE critic from the advisor pool via the same critique->tribunal->global cascade nero uses, skipping API-only engines that can't read code/run commands (advisory fallback if none). (2) Clone the live working tree into a throwaway CoW sandbox. (3) Dispatch the critic in AGENT mode against the sandbox to find a runnable counterexample. (4) MECHANICALLY re-run the proposed COUNTEREXAMPLE in the sandbox — `falsified` is true ONLY when the verdict is FLAWED with a counterexample, the command passes the isSafeCounterexample auto-exec gate, AND the re-run reproduces a failure (non-zero exit). An opinion with no reproducible command NEVER blocks. The full attack text is returned as advisory for the human merge gate. SECURITY: auto-exec runs ONLY inside the disposable sandbox with HOME/TMPDIR confined to it, never the live tree; the command is denylist-screened; time-bounded + abort-aware; ANY unexpected error fails SAFE to advisory (never blocks, never crashes the conquer loop). (FOLLOW-UP: real OS/container confinement with denied network for untrusted tasks; non-APFS sandbox strategy.) Sandbox + exec injected (SandboxOps) for unit-testing.
 */
export async function runDoneFalsifier(opts: FalsifierOptions, effects: FalsifierEffects): Promise<FalsifierResult> {
  const advisory = (over: Partial<FalsifierResult>): FalsifierResult => ({ falsified: false, counterexample: null, observed: null, attackText: '', critic: '', advisoryOnly: true, note: '', ...over });
  if (opts.signal?.aborted) return advisory({ note: 'aborted before falsification' });
  if (!opts.engines || opts.engines.length === 0) return advisory({ note: 'no advisor pool — falsification skipped' });
  const dispatchAgent = effects.adapter.dispatchAgent;
  if (!dispatchAgent) return advisory({ note: 'adapter has no agent-dispatch path — falsification skipped' });

  let ranked: ReturnType<FalsifierEffects['rankCritics']>;
  try { ranked = effects.rankCritics(opts.engines); }
  catch (error) {
    return advisory({ note: `critic ranking failed: ${error instanceof Error ? error.message : String(error)}` });
  }
  let critic = '';
  let criticEngine: EngineDefinition | null = null;
  for (const r of ranked) {
    try {
      const eng = effects.getEngine(r.engineId);
      if (isAgentCapableEngine(eng)) { critic = r.engineId; criticEngine = eng; break; }
    } catch { /* stale/unknown id — skip */ }
  }
  if (!critic || !criticEngine) return advisory({ note: 'no agent-capable critic in the advisor pool (API-only engines cannot read code) — falsification skipped; surfacing to the human gate' });

  // A private copy and redirected home paths reduce accidental writes.
  // They do not provide OS isolation. Process timeouts use milliseconds.
  const sandbox: SandboxOps = opts.sandbox ?? {
    clone: async (src, dest, signal) => {
      const cloned = await spawnWithTimeout({ command: 'cp', args: ['-Rc', src, dest], cwd: dirname(dest), timeout: 180_000, signal });
      if (cloned.exitCode === 0) return true;
      await sandbox.remove(dest);
      if (signal?.aborted) return false;
      const copied = await spawnWithTimeout({ command: 'cp', args: ['-R', src, dest], cwd: dirname(dest), timeout: 600_000, signal });
      return copied.exitCode === 0;
    },
    exec: async (cmd, cwd, timeoutMs, signal) => {
      const r = await spawnWithTimeout({ command: 'sh', args: ['-c', cmd], cwd, timeout: timeoutMs, signal, env: { HOME: cwd, TMPDIR: cwd, XDG_CONFIG_HOME: cwd, XDG_CACHE_HOME: cwd } });
      return { exitCode: r.exitCode, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), timedOut: r.timedOut === true };
    },
    remove: dir => rm(dir, { recursive: true, force: true }),
  };

  // Unique-per-run sandbox dir (random suffix avoids a same-millisecond collision).
  const sandboxDir = join(opts.outputDir, `sandbox-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`);
  let verificationDir: string | undefined;
  let attackText = '';
  let parsed: ReturnType<typeof parseFalsifierOutput> | undefined;
  const evidence = () => ({ critic, attackText, counterexample: parsed?.counterexample ?? null, observed: parsed?.observed ?? null });
  try {
    const cloned = await sandbox.clone(opts.cwd, sandboxDir, opts.signal);
    if (!cloned) return advisory({ critic, note: `sandbox clone of ${opts.cwd} failed — falsification skipped` });
    if (opts.signal?.aborted) return advisory({ critic, note: 'aborted after sandbox clone' });

    const prompt = buildFalsifierPrompt({ claim: opts.claim, gate: opts.gate });
    const sysPrompt = 'You are an adversarial falsification critic working inside a disposable sandbox copy of a repository. Use your tools to read code and run commands; verify any failure by executing it before concluding.';
    try {
      const res = await dispatchAgent({
        engine: criticEngine, prompt, systemPrompt: sysPrompt, cwd: sandboxDir,
        mode: 'agent', timeout: opts.timeout, outputDir: opts.outputDir, signal: opts.signal,
      });
      attackText = String(res?.stdout ?? '').trim().replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
      const dispatchOk = (res?.exitCode ?? 1) === 0 && res?.timedOut !== true;
      if (!dispatchOk || attackText.length === 0) {
        return advisory({ critic, attackText, note: res?.timedOut ? 'critic timed out — falsification inconclusive' : 'critic produced no usable output — falsification inconclusive' });
      }
    } catch (err) {
      if (opts.signal?.aborted || (err as any)?.name === 'AbortError') return advisory({ critic, note: 'aborted during critic dispatch' });
      return advisory({ critic, note: `critic dispatch failed: ${err instanceof Error ? err.message : String(err)} — falsification inconclusive` });
    }

    parsed = parseFalsifierOutput(attackText);
    // No FLAWED verdict or no runnable counterexample -> never block. Surface as advisory-not-blocking.
    if (parsed.verdict !== 'flawed' || !parsed.counterexample) {
      return { falsified: false, counterexample: parsed.counterexample, observed: parsed.observed, attackText, critic, advisoryOnly: false, note: parsed.verdict === 'sound' ? 'critic could not break the claim (SOUND)' : 'critic gave no reproducible counterexample — not blocking' };
    }

    // AUTO-EXEC SAFETY GATE: refuse to mechanically run a catastrophic/escaping
    // command. A rejected counterexample is surfaced to the human but NEVER executed
    // and never blocks (cannot be mechanically verified) — erring safe.
    if (!isSafeCounterexample(parsed.counterexample)) {
      return { falsified: false, counterexample: parsed.counterexample, observed: parsed.observed, attackText, critic, advisoryOnly: true, note: 'counterexample rejected by the auto-exec safety gate (destructive/escaping command) — not run; surfaced to the human gate' };
    }

    // MECHANICAL VERIFICATION (the anti-false-positive core): re-run the proposed
    // counterexample in the confined sandbox. Block ONLY if it actually reproduces a
    // failure (non-zero exit). A timeout/abort is inconclusive -> do NOT block. The
    // re-run gets its OWN bounded timeout (opts.timeout is SECONDS; spawn wants ms),
    // capped at 5 min — separate from the full critic-dispatch budget.
    if (opts.signal?.aborted) return { falsified: false, counterexample: parsed.counterexample, observed: parsed.observed, attackText, critic, advisoryOnly: false, note: 'aborted before mechanical verification — not blocking' };
    effects.assertCurrent?.();
    // Critic edits must not create or hide the failure under verification.
    verificationDir = `${sandboxDir}-verify`;
    const verificationReady = await sandbox.clone(opts.cwd, verificationDir, opts.signal);
    if (!verificationReady) return advisory({ ...evidence(), note: 'clean verification copy failed — counterexample not run' });
    if (opts.signal?.aborted) return advisory({ ...evidence(), note: 'aborted while preparing clean verification copy' });
    effects.assertCurrent?.();
    const rerunTimeoutMs = Math.min(Math.max(opts.timeout, 1), 300) * 1000;
    const rerun = await sandbox.exec(parsed.counterexample, verificationDir, rerunTimeoutMs, opts.signal);
    if (opts.signal?.aborted) return advisory({ ...evidence(), verification: rerun, note: 'aborted during mechanical verification — not blocking' });
    const missingInput = rerun.exitCode !== 0 ? missingCriticInput(rerun.stderr, sandboxDir, verificationDir) : undefined;
    if (missingInput) return advisory({ ...evidence(), verification: rerun,
      note: `reproduction input ${missingInput} exists only in the critic copy — setup is not reproducible; inline its creation in the counterexample` });
    const reproduced = rerun.timedOut !== true && rerun.exitCode !== 0;
    return {
      falsified: reproduced,
      counterexample: parsed.counterexample,
      observed: parsed.observed,
      attackText,
      critic,
      advisoryOnly: false,
      verification: rerun,
      note: reproduced
        ? `counterexample reproduced a failure (exit ${rerun.exitCode}) in the sandbox`
        : (rerun.timedOut ? 'counterexample re-run timed out — inconclusive, not blocking' : 'counterexample did NOT reproduce (exit 0) — rejected, not blocking'),
    };
  } catch (err) {
    // FAIL SAFE: any unexpected error (clone/exec throw, etc.) must never crash the
    // conquer loop nor block 'done' on a non-result — degrade to advisory.
    if (opts.signal?.aborted || (err as any)?.name === 'AbortError') return advisory({ ...evidence(), note: 'aborted during falsification' });
    return advisory({ ...evidence(), note: `falsifier errored: ${err instanceof Error ? err.message : String(err)} — degraded to advisory (not blocking)` });
  } finally {
    for (const directory of verificationDir ? [verificationDir, sandboxDir] : [sandboxDir]) {
      try { await sandbox.remove(directory); }
      catch (error) { console.warn(`[agon] falsifier cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
}

/**
 * Run the conquer done-oracle for a completion claim. CHEAP DETERMINISTIC LAYERS FIRST (L0/L1/L2): a tampered oracle, weakened existing tests, a red gate, or an empty claim each block immediately — WITHOUT cloning the repo or dispatching an agent (so a premature CONQUER_DONE never burns a full falsifier run). Only when those pass does the L4/L5 EVIDENCE-BASED falsifier run (a tool-enabled agent critic tries to reproduce a runnable counterexample in a throwaway sandbox; blocks ONLY on a mechanically-verified failure — never on a bare opinion). gateOk + oracleTampered are computed by the caller in the worktree. Returns `falsified` (was the block a verified reproduction?) plus the falsifier's attack text + counterexample for the human merge gate, whether or not they blocked.
 */
export async function runDoneOracle(opts: DoneOracleOptions, effects: FalsifierEffects): Promise<DoneOracleResult> {

  // L0/L1/L2 first (cheap, deterministic). If the claim is already doomed, skip the
  // expensive falsifier entirely — its outcome can't change the verdict.
  const pre = evaluateDoneEvidence({ ...opts, neroFalsified: false });
  if (!pre.passed) {
    return { ...pre, falsified: false, attackText: '', counterexample: null, observed: null, critic: '', advisoryOnly: false, note: pre.reason };
  }

  let falsifier: FalsifierResult = { falsified: false, counterexample: null, observed: null, attackText: '', critic: '', advisoryOnly: true, note: '' };
  if (!opts.signal?.aborted && opts.engines.length > 0) {
    falsifier = await runDoneFalsifier({
      claim: opts.claim, gate: opts.gate, cwd: opts.cwd, engines: opts.engines,
      timeout: opts.timeout,
      outputDir: opts.outputDir, signal: opts.signal, sandbox: opts.sandbox,
    }, effects);
  }

  const decision = evaluateDoneEvidence({ ...opts, neroFalsified: falsifier.falsified });
  return { ...falsifier, ...decision };
}
