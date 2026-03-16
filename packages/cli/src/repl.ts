import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { createInputEngine } from './input-engine.js';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import {
  EngineRegistry,
  ensureAgonHome,
  loadConfig,
  configSet,
  getElo,
  RUNS_DIR,
  DEFAULT_CONFIG,
  getEngineRating,
  scanProjectContext,
  tracker,
  estimateTokens,
  addWorkspace,
  removeWorkspace,
  listWorkspaces,
  getActiveWorkspace,
  switchWorkspace,
  ensureCurrentWorkspace,
  snapshotWorkspace,
  createPlan,
  advanceStep,
  mergeStepResult,
  approvePlan,
  startPlan,
  cancelPlan,
  failPlan,
  resetStepForRetry,
  canAutoApprove,
  savePlan,
  loadPlan,
  listPlans,
} from '@agon/core';
import type {
  AgonConfig, EngineAdapter, ForgeManifest,
  Plan, PlanStepInput, StepResult, ApprovalLevel,
} from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { runForge, runBrainstorm, runTribunal } from '@agon/forge';
import type { Intent } from './intent.js';
import { detectIntent, SLASH_COMMANDS } from './intent.js';
import {
  discoverEngines, preflightApply, applyPatchToTree,
  startChatSession, appendMessage, listChatSessions, loadChatSession,
  wordWrap, parseStreamChunk,
} from '@agon/core';
import type { ChatSession } from '@agon/core';
import { loadCaesar, isCaesarReady, caesarClassify, caesarSummarize, caesarTranslate, expandKernDraft } from './caesar.js';
import * as clack from '@clack/prompts';
import {
  bold,
  dim,
  cyan,
  green,
  red,
  yellow,
  white,
  italic,
  fg256,
  header,
  success,
  fail,
  warn,
  info,
  table,
  scoreboard,
  LOGO_COLORS,
  ENGINE_COLORS,
  gradientText,
} from './output.js';
import { displayPlan, displayPlanList } from './plan-display.js';

const VERSION = '0.1.0';

let registry: EngineRegistry;
let adapter: EngineAdapter;

// Session-level engine selection. null = use all available.
let sessionEngines: string[] | null = null;

// Session-level plan tracking.
let currentPlan: Plan | null = null;

// ── Chat state (conversational mode) ─────────────────────────────────
// Persistent chat session (KERN-sourced store in ~/.agon/chats/)
let chatSession: ChatSession = startChatSession();
const MAX_CHAT_HISTORY = 20;
let activeAbort: AbortController | null = null;

function chatContext(): string {
  if (chatSession.messages.length === 0) return '';
  const recent = chatSession.messages.slice(-MAX_CHAT_HISTORY);
  return recent.map(m =>
    m.role === 'user'
      ? `User: ${m.content}`
      : `${m.engineId ?? 'engine'}: ${m.content}`,
  ).join('\n\n');
}

/** Detect if message is addressed to a specific engine ("codex what do you think?") */
function detectTargetEngine(input: string): { engineId: string | null; message: string } {
  const available = registry.availableIds();
  const lower = input.toLowerCase();
  // Check if message starts with or contains engine name as addressee
  for (const id of available) {
    // "codex what do you think?" or "hey codex, ..."
    if (lower.startsWith(id + ' ') || lower.startsWith(id + ',') || lower.startsWith(id + ':')) {
      return { engineId: id, message: input.slice(id.length).replace(/^[,:\s]+/, '').trim() || input };
    }
    // "hey codex" or "yo claude"
    const heyPattern = new RegExp(`^(?:hey|yo|ok)\\s+${id}\\b[,:]?\\s*`, 'i');
    const heyMatch = input.match(heyPattern);
    if (heyMatch) {
      return { engineId: id, message: input.slice(heyMatch[0].length).trim() || input };
    }
  }
  return { engineId: null, message: input };
}

/** Get active engines for this session. */
function activeEngines(): string[] {
  const available = registry.availableIds();
  if (!sessionEngines) return available;
  return sessionEngines.filter((id) => available.includes(id));
}

function initRegistry(): void {
  registry = new EngineRegistry();
  const enginesDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../engines',
  );
  registry.load(enginesDir);
  adapter = createCliAdapter(registry);
}

async function initCaesar(): Promise<void> {
  const config = loadConfig();
  const modelId = config.caesarModel ?? 'none';
  if (modelId === 'none') return;

  process.stdout.write(`  ${dim('Loading Caesar...')}`);
  const ok = await loadCaesar(modelId);
  process.stdout.write('\r\x1b[2K');
  if (ok) {
    info(`Caesar (${modelId}) ready`);
  }
}

// ── Dashboard ────────────────────────────────────────────────────────


function renderDashboard(): void {
  const available = registry.availableIds();
  const allEngines = registry.list();
  const elo = getElo();

  // ── ASCII Art Logo + Version ──
  const logo = [
    '   ▄▀█ ▄▀▀ ▄▀▄ █▄ █',
    '   █▀█ ▀▄█ ▀▄▀ █ ▀█',
  ];

  console.log('');
  for (const line of logo) {
    console.log(`  ${gradientText(line, LOGO_COLORS)}`);
  }
  console.log(`  ${italic('   Any AI can join. They compete. You ship.')}`);
  console.log(`  ${dim(`   v${VERSION}`)}  ${dim('Powered by')} ${bold(fg256(220, 'KERNlang'))}`);
  console.log('');

  // ── Insights ──
  const readyCount = available.length;
  const totalEngines = allEngines.length;
  const totalMatches = Object.values(elo.global).reduce(
    (sum, r) => sum + r.wins + r.losses,
    0,
  );

  const insights: string[] = [];

  // Engine roster
  const engineTags = available.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id));
  insights.push(`${fg256(214, '⚔')}  ${bold(white(`${readyCount} engines`))} ready to compete  ${engineTags.join(dim('  '))}`);
  // Show default chat engine (user-configurable via /use or /config)
  const config = loadConfig();
  const defaultEngine = config.forgeFixedStarter ?? available[0] ?? 'none';
  const defaultColor = ENGINE_COLORS[defaultEngine] ?? 245;
  insights.push(`${fg256(33, '🧠')} Chat default: ${fg256(defaultColor, bold(defaultEngine))}  ${dim('(change with /use)')}`);

  if (readyCount < totalEngines) {
    const missing = allEngines.filter((e) => !registry.isAvailable(e)).map((e) => e.id);
    insights.push(`${fg256(240, '○')}  ${dim(`${missing.length} not installed: ${missing.join(', ')}`)}`);
  }

  // ELO stats
  if (totalMatches > 0) {
    const sorted = Object.entries(elo.global).sort(
      ([, a], [, b]) => b.rating - a.rating,
    );
    const [topId, topRating] = sorted[0];
    const topColor = ENGINE_COLORS[topId] ?? 255;
    const totalForges = Math.floor(totalMatches / 2);
    insights.push(`${fg256(220, '♛')}  ${fg256(topColor, bold(topId))} leads with ${bold(String(topRating.rating))} ELO  ${dim(`(${totalForges} forges run)`)}`);

    // Win rate insight
    const bestWinRate = sorted
      .filter(([, r]) => r.wins + r.losses >= 2)
      .map(([id, r]) => ({ id, pct: Math.round((r.wins / (r.wins + r.losses)) * 100) }))
      .sort((a, b) => b.pct - a.pct)[0];
    if (bestWinRate) {
      const wrColor = ENGINE_COLORS[bestWinRate.id] ?? 245;
      insights.push(`${fg256(34, '↑')}  ${fg256(wrColor, bestWinRate.id)} has best win rate at ${bold(`${bestWinRate.pct}%`)}`);
    }
  } else {
    insights.push(`${fg256(33, '◆')}  ${dim('No forges yet — run one to see engines battle')}`);
  }

  // Active workspace
  const activeWs = getActiveWorkspace();
  if (activeWs) {
    const kernTag = activeWs.isKern ? fg256(220, ' kern') : '';
    insights.push(`${fg256(245, '📂')} ${bold(activeWs.name)}${kernTag}  ${dim(activeWs.path)}`);
  }

  // Run history peek
  let runCount = 0;
  try {
    runCount = readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json')).length;
  } catch { /* no runs dir yet */ }
  if (runCount > 0) {
    insights.push(`${fg256(245, '📋')} ${dim(`${runCount} runs in history — type "history" to browse`)}`);
  }

  for (const line of insights) {
    console.log(`  ${line}`);
  }
  console.log('');

  // ── Quick Start ──
  console.log(`  ${bold(white('JUST TALK'))}  ${dim('— or say an engine name to pick who answers')}`);
  console.log(`  ${dim('─'.repeat(48))}`);
  console.log(`  ${fg256(245, '💬')} ${italic('"what do you think about the auth flow?"')}  ${dim('→ chat')}`);
  console.log(`  ${fg256(245, '💬')} ${italic('"codex how would you approach this?"')}     ${dim('→ codex')}`);
  console.log(`  ${fg256(214, '⚔')}  ${italic('"fix the login bug, test with npm test"')}  ${dim('→ forge')}`);
  console.log(`  ${fg256(33, '⚖')}  ${italic('"should we use REST or GraphQL?"')}        ${dim('→ tribunal')}`);
  console.log(`  ${fg256(141, '💡')} ${italic('"best approach for caching?"')}            ${dim('→ brainstorm')}`);
  console.log('');
  console.log(`  ${dim('/ for commands    /clear to reset chat    exit to quit')}`);
  console.log('');
}

function showHelp(): void {
  header('Natural Language');
  console.log('');
  console.log('  Just type naturally — Agon routes to the right command.');
  console.log('');
  console.log(`  ${fg256(214, '⚔')}  "fix X, test with npm test"  ${dim('→ forge')}`);
  console.log(`  ${fg256(33, '⚖')}  "should we X vs Y?"          ${dim('→ tribunal')}`);
  console.log(`  ${fg256(141, '💡')} "how should we approach X?"  ${dim('→ brainstorm')}`);
  console.log(`  ${fg256(245, '📊')} "leaderboard" / "engines"    ${dim('→ status')}`);

  showSlashList();

  // Active engines
  const active = activeEngines();
  console.log(`  ${bold(white('Active Engines'))}  ${sessionEngines ? yellow('(custom)') : dim('(all available)')}`);
  console.log(`  ${dim('─'.repeat(48))}`);
  console.log(`  ${active.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(', '))}`);
  console.log(`  ${dim('Change: /use claude,codex   Reset: /use all')}`);
  console.log('');
}

function showSlashList(): void {
  console.log('');
  for (const { cmd, desc } of SLASH_COMMANDS) {
    console.log(`  ${fg256(214, bold(cmd.padEnd(16)))}${dim(desc)}`);
  }
  console.log('');
}

async function showSlashPicker(): Promise<string | null> {
  // Interactive picker — like Claude Code / Codex / Gemini
  const result = await clack.select({
    message: 'Pick a command',
    options: SLASH_COMMANDS.map(({ cmd, desc }) => ({
      value: cmd,
      label: fg256(214, bold(cmd)),
      hint: desc.trim(),
    })),
  });

  if (clack.isCancel(result)) return null;
  return result as string;
}

// ── Spinner ──────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function startSpinner(msg: string): { update: (m: string) => void; stop: (m: string) => void; clear: () => void } {
  let i = 0;
  let text = msg;
  const timer = setInterval(() => {
    const frame = fg256(214, SPINNER_FRAMES[i % SPINNER_FRAMES.length]);
    process.stdout.write(`\r\x1b[2K  ${frame} ${dim(text)}`);
    i++;
  }, 80);

  return {
    update(m: string) { text = m; },
    stop(m: string) {
      clearInterval(timer);
      if (m) {
        process.stdout.write(`\r\x1b[2K  ${green('✓')} ${m}\n`);
      } else {
        process.stdout.write(`\r\x1b[2K`);
      }
    },
    /** Clear spinner without any output */
    clear() {
      clearInterval(timer);
      process.stdout.write(`\r\x1b[2K`);
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

async function askQuestion(question: string): Promise<string> {
  // During handler execution the InputEngine is paused.
  // Use a temporary readline for simple text prompts.
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }
  process.stdin.resume();

  const tempRl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    tempRl.question(question, (answer) => {
      tempRl.close();
      resolve(answer);
    });
  });
}

// ── Forge ────────────────────────────────────────────────────────────

async function handleForge(
  task: string,
  fitnessCmd: string | null,
  existingPlan?: Plan,
): Promise<void> {
  ensureAgonHome();

  if (!task) {
    warn('No task provided. Usage: "fix the auth bug, test with npm test"');
    return;
  }

  let fitness = fitnessCmd;
  if (!fitness) {
    fitness = await askQuestion(`  ${yellow('▸')} What command tests this? `);
    fitness = fitness.trim();
    if (!fitness) {
      warn('Forge needs a test command. Try again with: "fix X, test with npm test"');
      return;
    }
  }

  const engines = activeEngines();
  if (engines.length === 0) {
    fail('No engines available. Install at least one AI CLI tool.');
    return;
  }

  const config = loadConfig();
  let plan: Plan;

  if (existingPlan) {
    // Resume from an already-approved plan (e.g. via /approve)
    plan = startPlan(existingPlan);
    currentPlan = plan;
    savePlan(plan);
  } else {
    // ── Create Plan ──
    const ws = getActiveWorkspace();
    const snapshot = ws
      ? snapshotWorkspace(ws)
      : { id: 'cwd', path: process.cwd(), headSha: 'unknown', branch: 'unknown', dirty: false };

    const forgeSteps: PlanStepInput[] = [
      { id: 'baseline', kind: 'fitness', label: 'Baseline fitness check', effects: ['exec'] },
      { id: 'dispatch', kind: 'dispatch', label: `Dispatch engines: ${engines.join(', ')}`, effects: ['exec', 'write', 'network'] },
      { id: 'score', kind: 'fitness', label: 'Score engine results', effects: ['exec', 'read'] },
      { id: 'winner', kind: 'dispatch', label: 'Determine winner', effects: ['read'] },
    ];
    if (config.forgeEnableSynthesis) {
      forgeSteps.push({ id: 'synthesis', kind: 'synthesis', label: 'Critique & synthesize', effects: ['exec', 'write', 'network'] });
    }

    plan = createPlan(
      { type: 'forge', task, fitnessCmd: fitness, engines },
      snapshot,
      forgeSteps,
    );
    currentPlan = plan;

    // ── Display Plan ──
    displayPlan(plan);

    // Wire canAutoApprove: skip prompt if approval level allows
    const approvalLevel = (config.approvalLevel ?? 'plan') as ApprovalLevel;
    const skipApproval = approvalLevel === 'auto';

    if (!skipApproval) {
      const answer = await askQuestion(`  ${fg256(214, '▸')} ${bold('Approve plan?')} ${dim('[Y/n]')} `);
      if (answer.trim().toLowerCase() === 'n') {
        plan = cancelPlan(plan);
        currentPlan = plan;
        savePlan(plan);
        info('Plan cancelled.');
        return;
      }
    }

    plan = approvePlan(plan);
    plan = startPlan(plan);
    currentPlan = plan;
    savePlan(plan);
  }

  const forgeDir = join(RUNS_DIR, `forge-${Date.now()}`);
  mkdirSync(forgeDir, { recursive: true });

  console.log('');
  const projectCtx = scanProjectContext(process.cwd(), config.projectContext || undefined, config.contextFormat);

  // Engine build characters (Lemmings-style)
  const BUILD_CHARS: Record<string, string[]> = {
    claude:  ['🧑‍💻', '⛏️', '🔧', '🏗️'],
    codex:   ['👷', '🔨', '⚙️', '🏗️'],
    gemini:  ['🧙', '📐', '✨', '🏗️'],
    ollama:  ['🦙', '🪚', '🔩', '🏗️'],
    default: ['🤖', '⚒️', '🔧', '🏗️'],
  };

  const engineStatus: Record<string, string> = {};
  const startTime = Date.now();

  // Print initial lines for the animation BEFORE starting the interval
  for (const id of engines) {
    const color = ENGINE_COLORS[id] ?? 245;
    console.log(`  ${dim('○')} ${fg256(color, bold(id.padEnd(10)))} ${dim('queued')}`);
  }

  // Animated forge display — always rewrite all lines for safety at terminal bottom
  const forgeAnim = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const lines = engines.map((id) => {
      const color = ENGINE_COLORS[id] ?? 245;
      const chars = BUILD_CHARS[id] ?? BUILD_CHARS['default'];
      const frame = chars[Math.floor(elapsed / 2) % chars.length];
      const status = engineStatus[id] ?? 'waiting';

      if (status === 'done') {
        const score = engineStatus[`${id}:score`] ?? '?';
        return `  ${green('✓')} ${fg256(color, bold(id.padEnd(10)))} ${green(`done (${score})`)}`;
      }
      if (status === 'building') {
        const bar = '▓'.repeat(Math.min(10, Math.floor(elapsed / 3)));
        const empty = '░'.repeat(Math.max(0, 10 - bar.length));
        return `  ${frame} ${fg256(color, bold(id.padEnd(10)))} ${fg256(color, bar)}${dim(empty)} ${dim(`${elapsed}s`)}`;
      }
      return `  ${dim('○')} ${dim(id.padEnd(10))} ${dim('queued')}`;
    });

    // Always move cursor up and rewrite (initial lines already printed)
    process.stdout.write(`\x1b[${lines.length}A`);
    for (const line of lines) {
      process.stdout.write(`\x1b[2K${line}\n`);
    }
  }, 250);

  let manifest;
  // Set up abort so Ctrl+C can cancel this forge run
  const forgeAbort = new AbortController();
  activeAbort = forgeAbort;

  try {
    manifest = await runForge(
      {
        task,
        fitnessCmd: fitness,
        cwd: process.cwd(),
        forgeDir,
        engines,
        context: projectCtx,
        signal: forgeAbort.signal,
      },
      registry,
      adapter,
      (event) => {
        // Soft-cancel: if plan was cancelled via /cancel while running, ignore further events
        if (currentPlan?.state === 'cancelled') return;

        const id = event.engineId ?? '';
        switch (event.type) {
          case 'baseline:start':
            plan = mergeStepResult(plan, 'baseline', { state: 'running', attempts: [{ startedAt: new Date().toISOString() }] });
            break;
          case 'baseline:done':
            plan = mergeStepResult(plan, 'baseline', { state: 'completed' });
            if (event.data?.passes) {
              warn('Baseline passes — fitness test may be non-discriminating');
            }
            break;
          case 'stage1:dispatch':
            plan = mergeStepResult(plan, 'dispatch', { state: 'running', attempts: [{ startedAt: new Date().toISOString() }] });
            engineStatus[id] = 'building';
            break;
          case 'stage2:dispatch':
            engineStatus[id] = 'building';
            break;
          case 'stage1:accepted':
            engineStatus[id] = 'done';
            engineStatus[`${id}:score`] = String(event.data?.score ?? '?');
            break;
          case 'stage1:score':
          case 'stage2:score': {
            const scoreStep = plan.steps.find((s) => s.id === 'score');
            if (scoreStep && scoreStep.result.state === 'pending') {
              plan = mergeStepResult(plan, 'score', { state: 'running', attempts: [{ startedAt: new Date().toISOString() }] });
            }
            break;
          }
          case 'winner:determined': {
            plan = mergeStepResult(plan, 'dispatch', { state: 'completed' });
            plan = mergeStepResult(plan, 'score', { state: 'completed' });
            plan = mergeStepResult(plan, 'winner', { state: 'completed' });
            if (event.data?.winner) {
              const winnerId = String(event.data.winner);
              engineStatus[winnerId] = 'done';
              engineStatus[`${winnerId}:score`] = String(event.data.bestScore ?? '?');
            }
            break;
          }
          case 'synthesis:start':
            plan = mergeStepResult(plan, 'synthesis', { state: 'running', attempts: [{ startedAt: new Date().toISOString() }] });
            break;
          case 'synthesis:done':
            plan = mergeStepResult(plan, 'synthesis', { state: 'completed' });
            break;
        }
        currentPlan = plan;
      },
    );
  } catch (err) {
    // Stop animation and mark plan as failed (skip if already cancelled)
    clearInterval(forgeAnim);
    activeAbort = null;
    if (currentPlan?.state !== 'cancelled') {
      const errorMsg = err instanceof Error ? err.message : String(err);
      plan = failPlan(plan, errorMsg);
      currentPlan = plan;
      savePlan(plan);
    }
    throw err;
  }

  activeAbort = null;
  // Stop animation
  clearInterval(forgeAnim);

  // Mark all engines as done
  process.stdout.write(`\x1b[${engines.length}A`);
  for (const id of engines) {
    const color = ENGINE_COLORS[id] ?? 245;
    const r = manifest.results[id];
    if (r) {
      const status = r.pass ? green(`✓ ${r.score} pts`) : red('✗ failed');
      console.log(`\x1b[2K  ${r.pass ? '🏆' : '💀'} ${fg256(color, bold(id.padEnd(10)))} ${status}  ${dim(`${r.durationSec}s`)}`);
    } else {
      console.log(`\x1b[2K  ${dim('○')} ${dim(id.padEnd(10))} ${dim('not dispatched')}`);
    }
  }
  console.log('');

  // Scoreboard — engines as columns
  const engineIds = Object.keys(manifest.results);
  const results = Object.values(manifest.results);

  scoreboard('Forge Scoreboard', engineIds, [
    { label: 'Fitness', values: results.map((r) => r.pass ? green(`PASS (${r.score})`) : red('FAIL')) },
    { label: 'Score', values: results.map((r) => bold(String(r.score))) },
    { label: 'Diff size', values: results.map((r) => `${r.diffLines} lines`) },
    { label: 'Files changed', values: results.map((r) => String(r.filesChanged)) },
    { label: 'Time', values: results.map((r) => `${r.durationSec}s`) },
  ], manifest.winner);

  if (manifest.winner) {
    success(`Winner: ${bold(manifest.winner)}`);
    info(`Patch: ${manifest.patches[manifest.winner]}`);
  } else {
    fail('No winner — all engines failed');
  }
  info(`Manifest: ${forgeDir}/manifest.json`);

  // Finalize plan — ensure all steps are completed/skipped (handles stage-1 auto-accept)
  for (const step of plan.steps) {
    if (step.result.state === 'pending' || step.result.state === 'running') {
      plan = mergeStepResult(plan, step.id, { state: 'completed' });
    }
  }

  // Add artifacts to winner step
  const allPassed = Object.values(manifest.results).some((r) => r.pass);
  const winnerArtifacts = [
    { type: 'manifest' as const, path: `${forgeDir}/manifest.json` },
    ...(manifest.winner && manifest.patches[manifest.winner]
      ? [{ type: 'patch' as const, path: manifest.patches[manifest.winner], engineId: manifest.winner }]
      : []),
  ];
  plan = mergeStepResult(plan, 'winner', { state: 'completed', artifacts: winnerArtifacts });

  // Override to failed if no engine passed
  if (!allPassed) {
    plan = { ...plan, state: 'failed', currentStepId: null, updatedAt: new Date().toISOString() };
  }
  currentPlan = plan;
  savePlan(plan);
  info(`Plan: ${plan.id}`);

  // Track tokens for each engine
  for (const [id, r] of Object.entries(manifest.results)) {
    tracker.record(id, task, `score:${r.score} diff:${r.diffLines}`);
  }
  showInlineTokens('forge');
}

// ── Brainstorm ───────────────────────────────────────────────────────

async function handleBrainstorm(question: string): Promise<void> {
  ensureAgonHome();
  if (!question) {
    warn('No question provided. Usage: "best approach for caching?" or /brainstorm <question>');
    return;
  }

  const engines = activeEngines();
  if (engines.length === 0) {
    fail('No engines available.');
    return;
  }

  const outputDir = join(RUNS_DIR, `brainstorm-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  // Scan project context for engines
  const config = loadConfig();
  const projectCtx = scanProjectContext(process.cwd(), config.projectContext || undefined, config.contextFormat);

  const engineList = engines.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(', '));
  header(`Brainstorm: ${question}`);
  info(`Engines: ${engineList}`);
  if (projectCtx) info(`Context: ${dim(process.cwd())}`);
  console.log('');

  // Set up abort so Ctrl+C can cancel
  const bsAbort = new AbortController();
  activeAbort = bsAbort;

  // Per-engine animated progress (instead of single spinner)
  const THINK_FRAMES = ['◐', '◓', '◑', '◒'];
  const bsStart = Date.now();
  for (const id of engines) {
    const color = ENGINE_COLORS[id] ?? 245;
    console.log(`  ${dim('○')} ${fg256(color, bold(id.padEnd(10)))} ${dim('thinking…')}`);
  }
  const bsAnim = setInterval(() => {
    const elapsed = Math.floor((Date.now() - bsStart) / 1000);
    process.stdout.write(`\x1b[${engines.length}A`);
    for (const id of engines) {
      const color = ENGINE_COLORS[id] ?? 245;
      const frame = fg256(color, THINK_FRAMES[Math.floor(elapsed / 1) % THINK_FRAMES.length]);
      process.stdout.write(`\x1b[2K  ${frame} ${fg256(color, bold(id.padEnd(10)))} ${dim(`drafting… ${elapsed}s`)}\n`);
    }
  }, 250);

  const result = await runBrainstorm({
    question,
    context: projectCtx,
    engines,
    registry,
    adapter,
    timeout: 120,
    outputDir,
    signal: bsAbort.signal,
  });

  activeAbort = null;
  clearInterval(bsAnim);

  // Replace animation with final state
  process.stdout.write(`\x1b[${engines.length}A`);
  for (const id of engines) {
    const color = ENGINE_COLORS[id] ?? 245;
    const bid = result.bids.find((b) => b.engineId === id);
    const isWinner = bid?.engineId === result.winner;
    const status = bid
      ? (isWinner ? green('★ best draft') : green('✓ done'))
      : red('✗ no response');
    const prefix = bid ? (isWinner ? '★' : '✓') : '✗';
    process.stdout.write(`\x1b[2K  ${prefix} ${fg256(color, bold(id.padEnd(10)))} ${status}\n`);
  }

  // Show each engine's Kern draft
  console.log('');
  for (let i = 0; i < result.bids.length; i++) {
    const bid = result.bids[i];
    const color = ENGINE_COLORS[bid.engineId] ?? 245;
    const isWinner = bid.engineId === result.winner;
    const rank = `#${i + 1}`;
    const badge = isWinner ? green(' ★ best draft') : '';

    console.log(`  ${fg256(color, '┌──')} ${fg256(color, bold(bid.engineId))} ${dim(rank)}${badge}`);
    console.log(`  ${fg256(color, '│')}`);

    // Approach (thesis)
    console.log(`  ${fg256(color, '│')}  ${bold(bid.reasoning)}`);

    // Steps
    if (bid.approach) {
      const steps = bid.approach.split('\n').filter(Boolean);
      for (const step of steps.slice(0, 5)) {
        console.log(`  ${fg256(color, '│')}  ${dim(step)}`);
      }
    }

    console.log(`  ${fg256(color, '└──')}`);
    console.log('');
  }

  // Full response from winner — Caesar translates Kern to readable
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log(`  ${bold(white('RESPONSE'))}  ${dim('from')} ${fg256(ENGINE_COLORS[result.winner] ?? 245, bold(result.winner))}`);
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log('');

  let displayResponse = result.response;
  if (isCaesarReady()) {
    const translated = await caesarTranslate(result.response);
    if (translated) {
      displayResponse = translated;
      info(dim('(translated from Kern by Caesar — 0 cloud tokens)'));
    }
  }
  console.log(displayResponse);

  // Track tokens
  for (const bid of result.bids) {
    tracker.record(bid.engineId, question, bid.reasoning);
  }
  tracker.record(result.winner, question, result.response);
  showInlineTokens('brainstorm');

  // Offer next action
  await offerNextAction(question, result.winner);
}

// ── Post-brainstorm actions ──────────────────────────────────────────

async function offerNextAction(
  question: string,
  winnerId: string,
): Promise<void> {
  console.log('');
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log(`  ${bold(white('What next?'))}`);
  const active = activeEngines();
  console.log(`  ${bold('1.')} ${fg256(214, '⚔')}  Forge it ${dim('— all engines compete')}`);
  console.log(`  ${bold('2.')} ${fg256(34, '🔨')} Build it ${dim('— pick engine, plan first, then implement')}`);
  console.log(`  ${bold('3.')} ${fg256(33, '⚖')}  Tribunal ${dim('— debate it further')}`);
  console.log(`  ${dim('Enter to skip')}`);
  console.log('');

  const answer = await askQuestion(`  ${fg256(214, '❯')} `);
  const choice = answer.trim();

  switch (choice) {
    case '1':
    case 'forge': {
      const testCmd = await askQuestion(`  ${yellow('▸')} Test command: `);
      if (testCmd.trim()) {
        await handleForge(question, testCmd.trim());
      }
      break;
    }
    case '2':
    case 'build': {
      // Pick which engine builds
      console.log('');
      const engineOptions = active.map((id) => {
        const color = ENGINE_COLORS[id] ?? 245;
        const tag = id === winnerId ? ` ${dim('(winner)')}` : '';
        return `${fg256(color, bold(id))}${tag}`;
      });
      console.log(`  Engines: ${engineOptions.join(dim('  '))}`);
      const pick = await askQuestion(`  ${fg256(214, '❯')} Build with ${dim(`[default: ${winnerId}]`)}: `);
      const buildEngine = pick.trim() || winnerId;

      if (active.includes(buildEngine)) {
        await handleBuildWithPlan(question, buildEngine);
      } else {
        warn(`Engine "${buildEngine}" not available.`);
      }
      break;
    }
    case '3':
    case 'tribunal': {
      await handleTribunal(question);
      break;
    }
  }
}

async function handleBuildWithPlan(
  task: string,
  engineId: string,
): Promise<void> {
  ensureAgonHome();
  const engine = registry.get(engineId);
  const color = ENGINE_COLORS[engineId] ?? 245;

  const config = loadConfig();
  const projectCtx = scanProjectContext(process.cwd(), config.projectContext || undefined, config.contextFormat);

  // ── Create Plan ──
  const ws = getActiveWorkspace();
  const snapshot = ws
    ? snapshotWorkspace(ws)
    : { id: 'cwd', path: process.cwd(), headSha: 'unknown', branch: 'unknown', dirty: false };

  const buildSteps: PlanStepInput[] = [
    { id: 'plan', kind: 'dispatch', label: 'Get implementation plan', engineId, effects: ['exec', 'network'] },
    { id: 'implement', kind: 'dispatch', label: 'Implement the plan', engineId, effects: ['exec', 'write', 'network'] },
  ];

  let plan = createPlan(
    { type: 'build', task, engineId },
    snapshot,
    buildSteps,
  );
  currentPlan = plan;

  displayPlan(plan);
  savePlan(plan);

  // ── Phase 1: Plan (draft — engine plans, user hasn't approved yet) ──
  const planPrompt = [
    `## TASK\n${task}`,
    projectCtx ? `## CONTEXT\n${projectCtx}` : '',
    `## INSTRUCTIONS`,
    `Create an implementation plan. Do NOT write code yet. Return:`,
    `1. Files to create (with paths)`,
    `2. Files to modify (with paths)`,
    `3. Step-by-step implementation plan (3-7 steps)`,
    `4. What tests should verify the work`,
    ``,
    `Be specific — exact file paths, what each step does.`,
  ].filter(Boolean).join('\n\n');

  console.log('');
  const spin = startSpinner(`${engineId} is planning...`);

  const outputDir = join(RUNS_DIR, `build-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  const planStartedAt = new Date().toISOString();
  let planResult;
  try {
    planResult = await adapter.dispatch({
      engine,
      prompt: planPrompt,
      cwd: process.cwd(),
      mode: 'exec',
      timeout: 120,
      outputDir,
    });
  } catch (err) {
    spin.stop(`${engineId} failed to plan`);
    plan = mergeStepResult(plan, 'plan', {
      state: 'failed',
      attempts: [{ startedAt: planStartedAt, finishedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) }],
    });
    plan = failPlan(plan);
    currentPlan = plan;
    savePlan(plan);
    throw err;
  }

  spin.stop(`${engineId} has a plan`);

  plan = mergeStepResult(plan, 'plan', {
    state: 'completed',
    attempts: [{ startedAt: planStartedAt, finishedAt: new Date().toISOString() }],
    artifacts: [{ type: 'output', path: outputDir, engineId }],
    durationMs: planResult.durationMs,
  });
  currentPlan = plan;
  savePlan(plan);

  // Show the plan
  console.log('');
  console.log(`  ${fg256(color, '┌──')} ${fg256(color, bold(engineId))} ${dim('plan')}`);
  console.log(`  ${fg256(color, '│')}`);
  const planLines = planResult.stdout.split('\n');
  for (const line of planLines) {
    console.log(`  ${fg256(color, '│')} ${line}`);
  }
  console.log(`  ${fg256(color, '└──')}`);

  tracker.record(engineId, task, planResult.stdout);

  // ── Phase 2: Approve (plan stays draft until user says yes) ──
  console.log('');
  const approval = await askQuestion(
    `  ${fg256(214, '❯')} ${bold('Implement this plan?')} ${dim('[Y/n]')} `,
  );

  if (approval.trim().toLowerCase() === 'n') {
    plan = cancelPlan(plan);
    currentPlan = plan;
    savePlan(plan);
    info('Plan cancelled.');
    return;
  }

  // ── Phase 3: Implement (plan is already running from advanceStep above) ──
  plan = mergeStepResult(plan, 'implement', { state: 'running', attempts: [{ startedAt: new Date().toISOString() }] });
  currentPlan = plan;
  savePlan(plan);

  const buildPrompt = [
    `## TASK\n${task}`,
    projectCtx ? `## CONTEXT\n${projectCtx}` : '',
    `## YOUR PLAN\n${planResult.stdout}`,
    `## INSTRUCTIONS`,
    `Implement the plan above. Write the actual code.`,
    `Show each file with its full path. Be complete.`,
  ].filter(Boolean).join('\n\n');

  const buildSpin = startSpinner(`${engineId} is implementing...`);

  const implStartedAt = new Date().toISOString();
  let buildResult;
  try {
    buildResult = await adapter.dispatch({
      engine,
      prompt: buildPrompt,
      cwd: process.cwd(),
      mode: 'exec',
      timeout: 300,
      outputDir,
    });
  } catch (err) {
    buildSpin.stop(`${engineId} failed`);
    plan = mergeStepResult(plan, 'implement', {
      state: 'failed',
      attempts: [{ startedAt: implStartedAt, finishedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) }],
    });
    plan = failPlan(plan);
    currentPlan = plan;
    savePlan(plan);
    throw err;
  }

  buildSpin.stop(`${engineId} done`);

  plan = mergeStepResult(plan, 'implement', {
    state: buildResult.exitCode === 0 ? 'completed' : 'failed',
    attempts: [{ startedAt: implStartedAt, finishedAt: new Date().toISOString(), exitCode: buildResult.exitCode }],
    artifacts: [{ type: 'output', path: outputDir, engineId }],
    durationMs: buildResult.durationMs,
  });
  // mergeStepResult handles completed → plan completed, failed → plan paused
  if (buildResult.exitCode !== 0) {
    plan = failPlan(plan);
  }
  currentPlan = plan;
  savePlan(plan);

  // Show the code output
  console.log('');
  console.log(`  ${fg256(color, '┌──')} ${fg256(color, bold(engineId))} ${dim('implementation')}`);
  console.log(`  ${fg256(color, '│')}`);
  const codeLines = buildResult.stdout.split('\n');
  for (const line of codeLines) {
    console.log(`  ${fg256(color, '│')} ${line}`);
  }
  console.log(`  ${fg256(color, '└──')}`);

  info(`Plan: ${plan.id}`);
  tracker.record(engineId, task, buildResult.stdout);
  showInlineTokens('build');
}

// ── Campfire ─────────────────────────────────────────────────────────

async function handleCampfire(topic: string): Promise<void> {
  ensureAgonHome();

  const engines = activeEngines();
  if (engines.length === 0) {
    fail('No engines available.');
    return;
  }

  const config = loadConfig();
  const projectCtx = scanProjectContext(process.cwd(), config.projectContext || undefined, config.contextFormat);

  const prompt = [
    `## CAMPFIRE`,
    `Topic: ${topic || 'open discussion'}`,
    '',
    projectCtx ? `## Project Context\n${projectCtx}\n` : '',
    `## Rules`,
    `This is a campfire — no competition, no ranking, no winners.`,
    `Think freely. Share ideas, wild thoughts, "what if" scenarios.`,
    `Be honest. Say "I'm not sure" if you're not sure.`,
    `Build on the topic. Be interesting, not just useful.`,
    `Keep it concise — 3-5 paragraphs max.`,
  ].filter(Boolean).join('\n');

  console.log('');
  console.log(`  ${fg256(208, '🔥')} ${bold(white('Campfire'))}  ${dim('— no competition, just thinking together')}`);
  if (topic) console.log(`  ${dim('Topic:')} ${italic(topic)}`);
  console.log('');

  const outputDir = join(RUNS_DIR, `campfire-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  // Set up abort so Ctrl+C can cancel
  const cfAbort = new AbortController();
  activeAbort = cfAbort;

  // Per-engine animated progress
  const FIRE_FRAMES = ['🔥', '🪵', '✨', '💭'];
  const cfStart = Date.now();
  const cfStatus: Record<string, 'thinking' | 'done' | 'failed'> = {};
  for (const id of engines) {
    cfStatus[id] = 'thinking';
    const color = ENGINE_COLORS[id] ?? 245;
    console.log(`  ${dim('○')} ${fg256(color, bold(id.padEnd(10)))} ${dim('joining…')}`);
  }
  const cfAnim = setInterval(() => {
    const elapsed = Math.floor((Date.now() - cfStart) / 1000);
    process.stdout.write(`\x1b[${engines.length}A`);
    for (const id of engines) {
      const color = ENGINE_COLORS[id] ?? 245;
      if (cfStatus[id] === 'done') {
        process.stdout.write(`\x1b[2K  ${green('✓')} ${fg256(color, bold(id.padEnd(10)))} ${green('done')}\n`);
      } else if (cfStatus[id] === 'failed') {
        process.stdout.write(`\x1b[2K  ${red('✗')} ${fg256(color, bold(id.padEnd(10)))} ${red('missed')}\n`);
      } else {
        const frame = FIRE_FRAMES[Math.floor(elapsed / 1) % FIRE_FRAMES.length];
        process.stdout.write(`\x1b[2K  ${frame} ${fg256(color, bold(id.padEnd(10)))} ${dim(`thinking… ${elapsed}s`)}\n`);
      }
    }
  }, 250);

  // Stream responses as they arrive — don't wait for all
  const termWidth = process.stdout.columns || 80;
  const wrapWidth = termWidth - 8; // account for `  │ ` prefix

  // Clear animation, show final status
  function clearAnimation(): void {
    clearInterval(cfAnim);
    process.stdout.write(`\x1b[${engines.length}A`);
    for (const id of engines) {
      const c = ENGINE_COLORS[id] ?? 245;
      const ok = cfStatus[id] === 'done';
      const status = ok ? green('done') : cfStatus[id] === 'failed' ? red('missed') : dim('…');
      process.stdout.write(`\x1b[2K  ${ok ? green('✓') : cfStatus[id] === 'failed' ? red('✗') : dim('○')} ${fg256(c, bold(id.padEnd(10)))} ${status}\n`);
    }
  }

  let animCleared = false;
  const allDone = engines.map(async (engineId) => {
    const engine = registry.get(engineId);
    try {
      const result = await adapter.dispatch({
        engine,
        prompt,
        cwd: process.cwd(),
        mode: 'exec',
        timeout: 120,
        outputDir,
        signal: cfAbort.signal,
      });
      cfStatus[engineId] = 'done';

      // First completion clears the animation
      if (!animCleared) { animCleared = true; clearAnimation(); }

      // Print this engine's response immediately
      const color = ENGINE_COLORS[engineId] ?? 245;
      const lines = wordWrap(result.stdout.trim(), wrapWidth);
      console.log('');
      console.log(`  ${fg256(color, '┌──')} ${fg256(color, bold(engineId))}`);
      for (const line of lines.slice(0, 25)) {
        console.log(`  ${fg256(color, '│')} ${line}`);
      }
      if (lines.length > 25) console.log(`  ${fg256(color, '│')} ${dim(`…${lines.length - 25} more`)}`);
      console.log(`  ${fg256(color, '└──')}`);

      tracker.record(engineId, topic, result.stdout);
    } catch {
      cfStatus[engineId] = 'failed';
    }
  });

  await Promise.all(allDone);
  if (!animCleared) { animCleared = true; clearAnimation(); }
  activeAbort = null;

  showInlineTokens('campfire');
}

// ── Chat (conversational mode) ───────────────────────────────────────

async function handleChat(input: string): Promise<void> {
  ensureAgonHome();

  const { engineId: targetId, message } = detectTargetEngine(input);
  const config = loadConfig();
  const available = activeEngines();

  if (available.length === 0) {
    fail('No engines available.');
    return;
  }

  // Pick engine: explicit target > default starter > first available
  const engineId = targetId
    ?? config.forgeFixedStarter
    ?? available[0];

  if (!available.includes(engineId)) {
    fail(`${engineId} is not available. Try: ${available.join(', ')}`);
    return;
  }

  // Build prompt — keep it simple, engines have their own system context
  const history = chatContext();
  const parts: string[] = [];
  if (history) parts.push(history);
  parts.push(message);
  const prompt = parts.join('\n\n');

  const engine = registry.get(engineId);
  const color = ENGINE_COLORS[engineId] ?? 245;
  const outputDir = join(RUNS_DIR, `chat-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  // Set up abort so SIGINT can cancel this dispatch
  const abort = new AbortController();
  activeAbort = abort;

  const dispatchOpts = {
    engine,
    prompt,
    cwd: process.cwd(),
    mode: 'exec' as const,
    timeout: Math.min(config.timeout ?? 90, 90),
    outputDir,
    signal: abort.signal,
  };

  const spin = startSpinner(`${fg256(color, engineId)} ${dim('thinking…')}`);

  try {
    let response = '';
    let streaming = false;

    if (adapter.dispatchStream) {
      const gen = adapter.dispatchStream(dispatchOpts);

      while (true) {
        const { value, done } = await gen.next();
        if (done) break;
        if (abort.signal.aborted) break;

        // \x00 prefix = stderr (engine status)
        if (value.startsWith('\x00')) {
          const status = value.slice(1).trim();
          if (status) spin.update(`${fg256(color, engineId)} ${dim(status)}`);
          continue;
        }

        // Parse chunk (KERN-sourced: handles NDJSON + raw text)
        for (const parsed of parseStreamChunk(value)) {
          if (parsed.type === 'status') {
            spin.update(`${fg256(color, engineId)} ${dim(parsed.content)}`);
            continue;
          }
          if (parsed.type === 'result' && !streaming) {
            response = parsed.content;
            continue;
          }
          if (parsed.type === 'text' || parsed.type === 'raw') {
            if (!streaming) {
              spin.clear();
              console.log(`  ${fg256(color, bold(engineId))}`);
              streaming = true;
            }
            process.stdout.write(`  ${parsed.content}`);
            response += parsed.content;
          }
        }
      }
    } else {
      const result = await adapter.dispatch(dispatchOpts);
      response = result.stdout;
    }

    if (abort.signal.aborted) {
      spin.clear();
      activeAbort = null;
      return;
    }

    activeAbort = null;
    response = response.trim();

    if (!streaming && response) {
      spin.clear();
      console.log(`  ${fg256(color, bold(engineId))}`);
      const termWidth = process.stdout.columns || 80;
      const lines = wordWrap(response, termWidth - 4);
      for (const line of lines.slice(0, 30)) {
        console.log(`  ${line}`);
      }
      if (lines.length > 30) console.log(`  ${dim(`…${lines.length - 30} more lines`)}`);
    }
    if (streaming) console.log('');

    if (response) {
      appendMessage(chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(chatSession, { role: 'engine', engineId, content: response, timestamp: new Date().toISOString() });
      tracker.record(engineId, input, response);
    } else {
      spin.clear();
      info(dim('No response.'));
    }
  } catch (err) {
    spin.clear();
    activeAbort = null;
    if (abort.signal.aborted) return;
    fail(`${engineId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Tribunal ─────────────────────────────────────────────────────────

async function handleTribunal(question: string): Promise<void> {
  ensureAgonHome();
  if (!question) {
    warn('No question provided. Usage: "should we use REST or GraphQL?" or /tribunal <question>');
    return;
  }

  const active = activeEngines();
  if (active.length < 2) {
    fail(
      'Tribunal needs at least 2 engines. Only found: ' +
        (active.join(', ') || 'none'),
    );
    return;
  }

  const engines = active.slice(0, 4);
  const outputDir = join(RUNS_DIR, `tribunal-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  // Scan project context
  const config = loadConfig();
  const projectCtx = scanProjectContext(process.cwd(), config.projectContext || undefined, config.contextFormat);
  const enrichedQuestion = projectCtx
    ? `${question}\n\n## PROJECT CONTEXT\n${projectCtx}`
    : question;

  const engineList = engines.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(', '));
  header(`Tribunal: ${question}`);
  info(`Engines: ${engineList}`);
  if (projectCtx) info(`Context: ${dim(process.cwd())}`);
  info('Rounds: 2');
  console.log('');

  const spin = startSpinner('Engines debating...');

  const result = await runTribunal({
    question: enrichedQuestion,
    engines,
    rounds: 2,
    registry,
    adapter,
    timeout: 120,
    outputDir,
    onEvent: (event) => {
      if (event.data?.round) {
        const engineId = event.engineId;
        const position = event.data?.position;
        if (engineId && position) {
          spin.update(`Round ${event.data.round}: ${String(engineId)} (${String(position)}) arguing...`);
        }
      }
    },
  });

  spin.stop(`${result.rounds.length} rounds complete`);

  for (const round of result.rounds) {
    console.log('');
    header(`Round ${round.round}`);
    for (const pos of round.positions) {
      console.log('');
      console.log(`  ${bold(pos.engineId)} ${dim(`(${pos.position})`)}`);
      const arg = pos.arguments[0] ?? '';
      const lines = arg.slice(0, 500).split('\n');
      for (const line of lines) {
        console.log(`  ${line}`);
      }
      if (arg.length > 500) console.log(`  ${dim('...(truncated)')}`);
    }
  }

  console.log('');
  header('Verdict');
  console.log('');
  console.log(result.summary);
  console.log('');
  info(dim(`Full debate saved: ${outputDir}`));

  // Track tokens
  for (const round of result.rounds) {
    for (const pos of round.positions) {
      const args = pos.arguments.join(' ');
      tracker.record(pos.engineId, question, args);
    }
  }
  showInlineTokens('tribunal');
}

// ── Leaderboard ──────────────────────────────────────────────────────

function handleLeaderboard(): void {
  const elo = getElo();
  header('Global Leaderboard');
  const rows = Object.entries(elo.global)
    .sort(([, a], [, b]) => b.rating - a.rating)
    .map(([id, r], i) => [
      `${i + 1}.`,
      bold(id),
      String(r.rating),
      String(r.wins),
      String(r.losses),
      `${r.wins + r.losses > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : 0}%`,
    ]);

  if (rows.length === 0) {
    info('No matches recorded. Run a forge to start competing!');
    return;
  }
  table(['#', 'Engine', 'ELO', 'W', 'L', 'Win%'], rows);

  const classes = Object.keys(elo.byTaskClass);
  if (classes.length > 0) {
    console.log('');
    info(`Task classes with data: ${classes.join(', ')}`);
  }
}

// ── History ──────────────────────────────────────────────────────────

function handleHistory(id?: string): void {
  ensureAgonHome();

  if (id) {
    showRunDetail(id);
    return;
  }

  let files: string[];
  try {
    files = readdirSync(RUNS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    info('No forge runs yet.');
    return;
  }

  if (files.length === 0) {
    info('No forge runs yet.');
    return;
  }

  const recent = files.slice(0, 10);
  header(`Recent Runs (${Math.min(10, files.length)} of ${files.length})`);

  const rows: string[][] = [];
  for (const file of recent) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(RUNS_DIR, file), 'utf-8'),
      ) as ForgeManifest;
      const date = new Date(manifest.timestamp).toLocaleString();
      const taskStr =
        manifest.task.length > 40
          ? manifest.task.slice(0, 40) + '...'
          : manifest.task;
      const winner = manifest.winner ? green(manifest.winner) : red('none');
      const synthesis = manifest.synthesis?.wins ? 'yes' : '-';
      rows.push([
        date,
        taskStr,
        winner,
        String(manifest.enginesDispatched),
        synthesis,
        manifest.forgeId.slice(0, 8),
      ]);
    } catch {
      // skip malformed
    }
  }
  table(['Date', 'Task', 'Winner', 'Engines', 'Synth', 'ID'], rows);
  console.log('');
  info(dim('Use /history <id> for details'));
}

function showRunDetail(id: string): void {
  let files: string[];
  try {
    files = readdirSync(RUNS_DIR).filter((f) => f.includes(id));
  } catch {
    info(`Run "${id}" not found`);
    return;
  }

  if (files.length === 0) {
    info(`Run "${id}" not found`);
    return;
  }

  const manifest = JSON.parse(
    readFileSync(join(RUNS_DIR, files[0]), 'utf-8'),
  ) as ForgeManifest;

  header(`Forge Run: ${manifest.forgeId.slice(0, 8)}`);
  console.log(`  Task:       ${manifest.task}`);
  console.log(`  Fitness:    ${manifest.fitnessCmd}`);
  console.log(`  Date:       ${new Date(manifest.timestamp).toLocaleString()}`);
  console.log(`  Starter:    ${manifest.starter}`);
  console.log(`  Engines:    ${manifest.engines.join(', ')}`);
  console.log(`  Winner:     ${manifest.winner ? bold(manifest.winner) : red('none')}`);
  console.log(`  Close call: ${manifest.closeCall ? 'yes' : 'no'}`);
  console.log(`  Stage 1:    ${manifest.stage1Accepted ? green('auto-accepted') : 'escalated'}`);

  if (Object.keys(manifest.results).length > 0) {
    console.log('');
    header('Scores');
    const rows = Object.entries(manifest.results).map(([eid, r]) => [
      eid === manifest.winner ? green(`★ ${eid}`) : eid,
      r.pass ? green('PASS') : red('FAIL'),
      String(r.score),
      String(r.diffLines),
      String(r.filesChanged),
      `${r.durationSec}s`,
    ]);
    table(['Engine', 'Status', 'Score', 'Diff', 'Files', 'Time'], rows);
  }

  if (manifest.synthesis) {
    console.log('');
    header('Synthesis');
    console.log(`  Pass:     ${manifest.synthesis.pass ? green('yes') : red('no')}`);
    console.log(`  Score:    ${manifest.synthesis.score}`);
    console.log(`  Wins:     ${manifest.synthesis.wins ? green('yes') : 'no'}`);
    console.log(`  Original: ${manifest.synthesis.originalWinnerScore}`);
  }
}

// ── Engines ──────────────────────────────────────────────────────────

async function handleEngines(): Promise<void> {
  header('Engines');
  process.stdout.write(`  ${dim('Scanning...')}`);

  const engines = registry.list();
  const results = await Promise.all(
    engines.map(async (engine) => {
      const avail = registry.isAvailable(engine);
      const version = avail ? ((await adapter.getVersion(engine)) ?? dim('unknown')) : '';
      return { engine, avail, version };
    }),
  );

  process.stdout.write('\r\x1b[2K');

  const rows = results.map(({ engine, avail, version }) => [
    avail ? green(engine.id) : red(engine.id),
    engine.displayName,
    avail ? green('installed') : red('missing'),
    version,
    engine.tier,
  ]);
  table(['ID', 'Name', 'Status', 'Version', 'Tier'], rows);
}

async function handleDiscover(): Promise<void> {
  header('Engine Discovery');
  const spin = startSpinner('Scanning installed engines...');

  const results = await discoverEngines(registry, adapter);
  spin.stop(`${results.length} engines checked`);

  const found = results.filter((r) => r.found);
  const missing = results.filter((r) => !r.found);

  if (found.length > 0) {
    console.log('');
    const rows = found.map((r) => [
      green(r.id),
      r.displayName,
      r.version ?? dim('unknown'),
      r.envOk ? green('ok') : yellow(r.missingEnv.join(', ')),
    ]);
    table(['Engine', 'Name', 'Version', 'Env'], rows);
  }

  if (missing.length > 0) {
    console.log('');
    info(`Not installed: ${missing.map((r) => dim(r.id)).join(', ')}`);
  }

  // Offer to set active engines from discovered ones
  if (found.length > 0) {
    console.log('');
    const currentActive = sessionEngines ?? loadConfig().forgeEnabledEngines;
    const newEngines = found.filter((r) => !currentActive.includes(r.id));
    if (newEngines.length > 0) {
      info(`New: ${newEngines.map((r) => fg256(ENGINE_COLORS[r.id] ?? 245, bold(r.id))).join(', ')}`);
      info(`Run ${dim('/use <engines>')} to activate them.`);
    }
  }
}

async function handleApplyPatch(patchPath?: string, force?: boolean): Promise<void> {
  // Resolve manifest path from current plan if no explicit path given
  let manifestPath: string | null = null;
  if (!patchPath && currentPlan) {
    const forgeDir = currentPlan.action.type === 'forge'
      ? join(RUNS_DIR, `forge-${currentPlan.id}`)
      : null;
    // Find patch artifact from plan steps
    for (const step of currentPlan.steps) {
      const patchArtifact = step.result.artifacts?.find((a) => a.type === 'patch');
      if (patchArtifact) {
        patchPath = patchArtifact.path;
        break;
      }
      const manifestArtifact = step.result.artifacts?.find((a) => a.type === 'manifest');
      if (manifestArtifact) {
        manifestPath = manifestArtifact.path;
      }
    }
  }

  const preflight = preflightApply(process.cwd(), patchPath ?? null, manifestPath);

  if (!preflight.ok && preflight.dirtyTree && force) {
    // --force overrides dirty tree check, re-run without that gate
    if (preflight.patch) {
      warn('Working tree is dirty — applying anyway (--force).');
    } else {
      fail(preflight.error ?? 'No patch found.');
      return;
    }
  } else if (!preflight.ok) {
    fail(preflight.error ?? 'Preflight failed.');
    return;
  }

  const patch = preflight.patch!;
  info(`Patch: ${dim(patch.path)}`);
  info(`Engine: ${fg256(ENGINE_COLORS[patch.engineId] ?? 245, bold(patch.engineId))}`);
  info(`Changes: ~${patch.lineCount} lines`);

  const answer = await askQuestion(`  ${yellow('▸')} Apply to ${dim(process.cwd())}? ${dim('[Y/n]')} `);
  if (answer.trim().toLowerCase() === 'n') {
    info('Cancelled.');
    return;
  }

  const result = applyPatchToTree(process.cwd(), patch.content);
  if (result.ok) {
    success('Patch applied. Review changes with git diff.');
  } else {
    fail(`Apply failed: ${result.error}`);
  }
}

function handleChats(sessionId?: string): void {
  if (sessionId) {
    // Show specific session transcript
    const session = loadChatSession(sessionId);
    if (!session) {
      fail(`Session not found: ${sessionId}`);
      return;
    }
    header(`Chat: ${session.id}`);
    info(`Started: ${dim(session.startedAt)}  Messages: ${session.messages.length}`);
    console.log('');
    for (const msg of session.messages) {
      if (msg.role === 'user') {
        console.log(`  ${bold('You:')} ${msg.content}`);
      } else {
        const color = ENGINE_COLORS[msg.engineId ?? ''] ?? 245;
        console.log(`  ${fg256(color, bold(msg.engineId ?? 'engine'))}${dim(':')} ${msg.content.slice(0, 200)}${msg.content.length > 200 ? dim('…') : ''}`);
      }
    }
    return;
  }

  // List recent sessions
  const sessions = listChatSessions(20);
  if (sessions.length === 0) {
    info('No chat sessions yet.');
    return;
  }
  header('Chat Sessions');
  const rows = sessions.map((s) => {
    const firstMsg = s.messages.find((m) => m.role === 'user');
    const preview = firstMsg ? firstMsg.content.slice(0, 40) : dim('(empty)');
    return [
      dim(s.id),
      String(s.messages.length),
      s.startedAt.slice(0, 10),
      preview,
    ];
  });
  table(['Session', 'Msgs', 'Date', 'First Message'], rows);
  console.log('');
  info(`View a session: ${dim('/chats <id>')}`);
}

// ── Config ───────────────────────────────────────────────────────────

function handleConfig(intent: Intent & { type: 'config' }): void {
  ensureAgonHome();
  const action = intent.action ?? 'list';

  switch (action) {
    case 'list': {
      header('Configuration');
      const config = loadConfig(process.cwd());
      const rows = Object.entries(config).map(([key, value]) => {
        const defaultVal = DEFAULT_CONFIG[key as keyof typeof DEFAULT_CONFIG];
        const isDefault = JSON.stringify(value) === JSON.stringify(defaultVal);
        return [
          key,
          String(Array.isArray(value) ? value.join(',') : value),
          isDefault ? 'default' : 'custom',
        ];
      });
      table(['Key', 'Value', 'Source'], rows);
      break;
    }

    case 'get': {
      if (!intent.key) {
        fail('Usage: /config get <key>');
        return;
      }
      const config = loadConfig(process.cwd());
      const key = intent.key as keyof AgonConfig;
      if (key in config) {
        const value = config[key as keyof typeof config];
        console.log(Array.isArray(value) ? value.join(',') : String(value));
      } else {
        fail(`Unknown key: ${intent.key}`);
      }
      break;
    }

    case 'set': {
      if (!intent.key || intent.value === undefined) {
        fail('Usage: /config set <key> <value>');
        return;
      }

      const key = intent.key as keyof AgonConfig;
      if (!(key in DEFAULT_CONFIG)) {
        fail(`Unknown key: ${intent.key}`);
        return;
      }

      const defaultVal = DEFAULT_CONFIG[key];
      let parsed: unknown;

      if (typeof defaultVal === 'boolean') {
        parsed = intent.value === 'true';
      } else if (typeof defaultVal === 'number') {
        parsed = parseInt(intent.value, 10);
        if (isNaN(parsed as number)) {
          fail(`Invalid number: ${intent.value}`);
          return;
        }
      } else if (Array.isArray(defaultVal)) {
        parsed = intent.value.split(',').map((s) => s.trim());
      } else {
        parsed = intent.value;
      }

      configSet(key, parsed as AgonConfig[typeof key]);
      success(`Set ${bold(intent.key)} = ${intent.value}`);
      break;
    }

    default:
      fail(`Unknown config action: ${action}`);
      info('Available: list, get, set');
  }
}

// ── /use handler ─────────────────────────────────────────────────────

function handleUse(engineIds: string[]): void {
  if (engineIds.length === 0 || (engineIds.length === 1 && engineIds[0] === 'all')) {
    sessionEngines = null;
    success('Using all available engines');
    const all = registry.availableIds();
    console.log(`  ${all.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(', '))}`);
    return;
  }

  const available = registry.availableIds();
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const id of engineIds) {
    if (available.includes(id)) {
      valid.push(id);
    } else {
      invalid.push(id);
    }
  }

  if (invalid.length > 0) {
    warn(`Not available: ${invalid.join(', ')}`);
  }

  if (valid.length === 0) {
    fail('No valid engines selected. Available: ' + available.join(', '));
    return;
  }

  sessionEngines = valid;
  success(`Active engines: ${valid.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(', '))}`);
}

// ── /tokens handler ─────────────────────────────────────────────────

function handleTokens(): void {
  const stats = tracker.getStats();

  header('Token Usage — This Session');
  console.log('');

  if (stats.dispatches === 0) {
    info('No engine dispatches yet.');
    return;
  }

  const rows = Object.entries(stats.byEngine).map(([id, e]) => {
    const color = ENGINE_COLORS[id] ?? 245;
    const cost = e.costUsd > 0 ? `$${e.costUsd.toFixed(4)}` : green('free');
    return [
      fg256(color, bold(id)),
      String(e.dispatches),
      String(e.promptTokens),
      String(e.responseTokens),
      bold(String(e.totalTokens)),
      cost,
    ];
  });

  table(['Engine', 'Calls', 'Prompt', 'Response', 'Total', 'Cost'], rows);

  console.log('');
  const totalCost = stats.totalCostUsd > 0
    ? `$${stats.totalCostUsd.toFixed(4)}`
    : green('free');
  console.log(`  ${bold('Session total:')} ${bold(String(stats.totalTokens))} tokens  ${totalCost}`);
  console.log(`  ${dim(`${stats.dispatches} dispatches across ${Object.keys(stats.byEngine).length} engines`)}`);
}

/** Show inline token summary after a command (compact one-liner). */
function showInlineTokens(label: string): void {
  const recent = tracker.recent(10);
  if (recent.length === 0) return;

  // Show tokens from the most recent batch (same timestamp ± 5s)
  const cutoff = Date.now() - 30_000;
  const batch = recent.filter((u) => u.timestamp > cutoff);
  if (batch.length === 0) return;

  const total = batch.reduce((sum, u) => sum + u.totalTokens, 0);
  const cost = batch.reduce((sum, u) => sum + u.costUsd, 0);
  const engines = batch.map((u) => {
    const color = ENGINE_COLORS[u.engineId] ?? 245;
    return `${fg256(color, u.engineId)}:${u.totalTokens}`;
  }).join(dim('  '));

  const costStr = cost > 0 ? `  ~$${cost.toFixed(4)}` : '';
  console.log(`  ${dim('⟐')} ${dim(`${total} tokens`)}  ${engines}${dim(costStr)}`);
}

// ── /models handler ─────────────────────────────────────────────────

async function handleModels(): Promise<void> {
  const config = loadConfig();
  const available = registry.availableIds();

  // Engine selection with arrow keys
  const selected = await clack.multiselect({
    message: 'Active engines',
    options: available.map((id) => ({
      value: id,
      label: fg256(ENGINE_COLORS[id] ?? 245, bold(id)),
      hint: (() => {
        const r = getEngineRating(id);
        return r.wins + r.losses > 0 ? `ELO ${r.rating}` : '';
      })(),
    })),
    initialValues: sessionEngines ?? available,
    required: true,
  });

  if (!clack.isCancel(selected)) {
    sessionEngines = selected as string[];
    configSet('forgeEnabledEngines', selected as string[]);
    success(`Active: ${(selected as string[]).map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(', '))}`);
  }

  // Caesar model with arrow keys
  const currentCaesar = config.caesarModel ?? 'smollm2-360m';
  const caesarChoice = await clack.select({
    message: 'Caesar model',
    options: [
      { value: 'smollm2-360m', label: bold('SmolLM2-135M'), hint: 'tiny, instant' },
      { value: 'qwen-0.5b', label: bold('Qwen2.5-0.5B'), hint: 'smarter, better summaries' },
      { value: 'none', label: bold('None'), hint: 'keyword matching only' },
    ],
    initialValue: currentCaesar,
  });

  if (!clack.isCancel(caesarChoice)) {
    configSet('caesarModel', caesarChoice as 'smollm2-360m' | 'qwen-0.5b' | 'none');
    const names: Record<string, string> = { 'smollm2-360m': 'SmolLM2-135M', 'qwen-0.5b': 'Qwen2.5-0.5B', none: 'None' };
    success(`Caesar: ${bold(names[caesarChoice as string] ?? caesarChoice)}`);
  }
}

// ── Workspace handler ────────────────────────────────────────────────

function handleWorkspace(action: string, path?: string): void {
  switch (action) {
    case 'add': {
      if (!path) { fail('Usage: /workspace add <path>'); return; }
      const ws = addWorkspace(path);
      success(`Added ${bold(ws.name)} ${ws.isKern ? fg256(220, '(Kern project)') : ''}`);
      info(`  ${dim(ws.path)}`);
      break;
    }
    case 'remove': {
      if (!path) { fail('Usage: /workspace remove <id>'); return; }
      if (removeWorkspace(path)) success(`Removed ${path}`);
      else fail(`Workspace "${path}" not found`);
      break;
    }
    case 'switch': {
      if (!path) { fail('Usage: /workspace switch <id>'); return; }
      const ws = switchWorkspace(path);
      if (ws) success(`Active: ${bold(ws.name)} ${dim(ws.path)}`);
      else fail(`Workspace "${path}" not found`);
      break;
    }
    case 'list':
    default: {
      const all = listWorkspaces();
      const active = getActiveWorkspace();
      if (all.length === 0) {
        info('No workspaces. Current directory is used by default.');
        info(`Add with: /workspace add ${process.cwd()}`);
        return;
      }
      header('Workspaces');
      console.log('');
      for (const ws of all) {
        const isActive = ws.id === active?.id;
        const marker = isActive ? green('●') : dim('○');
        const kern = ws.isKern ? fg256(220, ' kern') : '';
        console.log(`  ${marker} ${bold(ws.name)}${kern}  ${dim(ws.path)}`);
      }
      break;
    }
  }
}

// ── REPL Loop ────────────────────────────────────────────────────────

// ── Plan Commands ────────────────────────────────────────────────────

function handlePlanShow(planId?: string): void {
  if (planId) {
    const plan = loadPlan(planId);
    if (!plan) {
      warn(`Plan not found: ${planId}`);
      return;
    }
    displayPlan(plan);
    return;
  }

  if (currentPlan) {
    displayPlan(currentPlan);
    return;
  }

  // Show most recent plan
  const recent = listPlans(1);
  if (recent.length > 0) {
    displayPlan(recent[0]);
  } else {
    info('No plans yet. Run /forge or build to create one.');
  }
}

function handlePlansList(): void {
  const plans = listPlans(20);
  displayPlanList(plans);
}

async function handleApprove(): Promise<void> {
  if (!currentPlan) {
    warn('No active plan to approve.');
    return;
  }
  if (currentPlan.state !== 'draft') {
    warn(`Plan is ${currentPlan.state}, not draft.`);
    return;
  }

  currentPlan = approvePlan(currentPlan);
  savePlan(currentPlan);
  success('Plan approved.');

  // Re-execute based on plan type, passing the existing plan to skip duplicate creation
  if (currentPlan.action.type === 'forge') {
    await handleForge(currentPlan.action.task, currentPlan.action.fitnessCmd ?? null, currentPlan);
  } else {
    info('Run the build again to execute.');
  }
}

async function handleRetry(): Promise<void> {
  if (!currentPlan) {
    warn('No active plan to retry.');
    return;
  }
  if (currentPlan.state !== 'paused' && currentPlan.state !== 'failed') {
    warn(`Plan is ${currentPlan.state} — only paused/failed plans can be retried.`);
    return;
  }

  const failedStep = currentPlan.steps.find((s) => s.result.state === 'failed');
  if (!failedStep) {
    info('No failed step found. Re-run the command to restart.');
    return;
  }

  info(`Retrying from: ${failedStep.label}`);
  currentPlan = resetStepForRetry(currentPlan, failedStep.id);
  savePlan(currentPlan);

  // Re-execute: startPlan transitions approved → running, then dispatch
  if (currentPlan.action.type === 'forge') {
    currentPlan = startPlan(currentPlan);
    savePlan(currentPlan);
    await handleForge(currentPlan.action.task, currentPlan.action.fitnessCmd ?? null, currentPlan);
  } else {
    info('Plan reset to approved. Run the build again to execute.');
  }
}

function handleCancel(): void {
  if (!currentPlan) {
    warn('No active plan to cancel.');
    return;
  }
  if (currentPlan.state === 'completed' || currentPlan.state === 'cancelled') {
    warn(`Plan already ${currentPlan.state}.`);
    return;
  }
  currentPlan = cancelPlan(currentPlan);
  savePlan(currentPlan);
  success('Plan cancelled.');
}

export async function startRepl(): Promise<void> {
  ensureAgonHome();
  initRegistry();
  await initCaesar();
  ensureCurrentWorkspace(process.cwd());

  // Reset stdin after clack prompts (onboarding puts it in raw mode)
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }
  process.stdin.resume();

  // Clean slate for the dashboard
  console.clear();
  renderDashboard();

  let busy = false;

  function buildPrompt(): string {
    const base = `  ${fg256(208, '▸')} ${bold(white('agon'))}`;
    if (sessionEngines) {
      const tag = sessionEngines.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(','));
      return `${base} ${dim('[')}${tag}${dim(']')} ${fg256(214, '❯')} `;
    }
    return `${base} ${fg256(214, '❯')} `;
  }

  function handleSigint(): void {
    if (busy && activeAbort) {
      // Cancel running dispatch, stay in REPL
      activeAbort.abort();
      activeAbort = null;
      console.log(`\n  ${yellow('⚡')} ${dim('Cancelled.')}`);
      return;
    }
    console.log(`\n  ${dim('Goodbye.')}\n`);
    inputEngine.close();
  }

  // Declare before creating so closures inside createInputEngine can reference it safely
  let inputEngine: ReturnType<typeof createInputEngine>;
  inputEngine = createInputEngine({
    prompt: buildPrompt,
    onSubmit: (line: string) => {
      handleLine(line).catch((err) => {
        fail(err instanceof Error ? err.message : String(err));
        busy = false;
        inputEngine.resume();
        console.log('');
        inputEngine.showPrompt();
      });
    },
    onInterrupt: handleSigint,
    commands: SLASH_COMMANDS,
  });

  inputEngine.showPrompt();

  async function handleLine(line: string): Promise<void> {
    const input = line.trim();
    if (!input) {
      inputEngine.showPrompt();
      return;
    }

    // Allow /cancel and /plan through even when busy
    const quickIntent = detectIntent(input);
    if (busy && quickIntent.type !== 'cancel' && quickIntent.type !== 'plan') {
      warn('A command is running. Please wait...');
      return;
    }
    if (busy && quickIntent.type === 'cancel') {
      handleCancel();
      inputEngine.showPrompt();
      return;
    }
    if (busy && quickIntent.type === 'plan') {
      handlePlanShow(quickIntent.planId);
      inputEngine.showPrompt();
      return;
    }

    // Lock input before any async work to prevent re-entry
    busy = true;
    inputEngine.pause();

    // Echo user input so it stays visible in the output
    console.log(`  ${dim('❯')} ${input}`);

    // Intent detection — silent, no UI noise
    let intent = detectIntent(input);
    if (intent.type === 'unknown' && isCaesarReady()) {
      const caesarIntent = await caesarClassify(input);
      if (caesarIntent) {
        switch (caesarIntent) {
          case 'forge':
            intent = { type: 'forge', task: input, fitnessCmd: null };
            break;
          case 'brainstorm':
            intent = { type: 'brainstorm', question: input };
            break;
          case 'tribunal':
            intent = { type: 'tribunal', question: input };
            break;
          case 'leaderboard':
            intent = { type: 'leaderboard' };
            break;
          case 'history':
            intent = { type: 'history' };
            break;
          case 'engines':
            intent = { type: 'engines' };
            break;
          case 'config':
            intent = { type: 'config' };
            break;
          case 'help':
            intent = { type: 'help' };
            break;
          case 'exit':
            intent = { type: 'exit' };
            break;
        }
      }
    }

    try {
      switch (intent.type) {
        case 'forge':
          await handleForge(intent.task, intent.fitnessCmd);
          break;
        case 'brainstorm':
          await handleBrainstorm(intent.question);
          break;
        case 'tribunal':
          await handleTribunal(intent.question);
          break;
        case 'campfire':
          await handleCampfire(intent.topic);
          break;
        case 'workspace':
          handleWorkspace(intent.action, intent.path);
          break;
        case 'leaderboard':
          handleLeaderboard();
          break;
        case 'history':
          handleHistory(intent.id);
          break;
        case 'engines':
          await handleEngines();
          break;
        case 'discover':
          await handleDiscover();
          break;
        case 'apply':
          await handleApplyPatch(intent.patchPath, intent.force);
          break;
        case 'chats':
          handleChats(intent.sessionId);
          break;
        case 'config':
          handleConfig(intent);
          break;
        case 'use':
          handleUse(intent.engineIds);
          break;
        case 'models':
          await handleModels();
          break;
        case 'tokens':
          handleTokens();
          break;
        case 'plan':
          handlePlanShow(intent.planId);
          break;
        case 'plans':
          handlePlansList();
          break;
        case 'approve':
          await handleApprove();
          break;
        case 'retry':
          await handleRetry();
          break;
        case 'cancel':
          handleCancel();
          break;
        case 'chat':
          await handleChat(intent.input);
          break;
        case 'clear':
          chatSession = startChatSession();
          info('Chat history cleared.');
          break;
        case 'slash-list': {
          // Fallback picker (via @clack) — only reached if '/' is pasted + Enter
          const picked = await showSlashPicker();
          if (picked) {
            const pickedIntent = detectIntent(picked);
            switch (pickedIntent.type) {
              case 'forge': await handleForge(pickedIntent.task, pickedIntent.fitnessCmd); break;
              case 'brainstorm': await handleBrainstorm(pickedIntent.question); break;
              case 'tribunal': await handleTribunal(pickedIntent.question); break;
              case 'campfire': await handleCampfire(pickedIntent.topic); break;
              case 'leaderboard': handleLeaderboard(); break;
              case 'history': handleHistory(pickedIntent.id); break;
              case 'engines': await handleEngines(); break;
              case 'config': handleConfig(pickedIntent); break;
              case 'tokens': handleTokens(); break;
              case 'models': await handleModels(); break;
              case 'plan': handlePlanShow(pickedIntent.planId); break;
              case 'plans': handlePlansList(); break;
              case 'approve': await handleApprove(); break;
              case 'retry': await handleRetry(); break;
              case 'cancel': handleCancel(); break;
              case 'help': showHelp(); break;
              case 'workspace': handleWorkspace(pickedIntent.action, pickedIntent.path); break;
              case 'use': handleUse(pickedIntent.engineIds); break;
              case 'clear': chatSession = startChatSession(); info('Chat history cleared.'); break;
              case 'exit': console.log(`\n  ${dim('Goodbye.')}\n`); inputEngine.close(); return;
            }
          }
          break;
        }
        case 'help':
          showHelp();
          break;
        case 'exit':
          console.log(`\n  ${dim('Goodbye.')}\n`);
          inputEngine.close();
          return;
        case 'unknown':
          // Chat mode — just talk to an engine
          await handleChat(intent.input);
          break;
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
      // Reset stdin in case clack put it in raw mode
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(false);
      }
      inputEngine.resume();
      console.log(`\n${dim('─'.repeat(48))}\n`);
      inputEngine.showPrompt();
    }
  }
}
