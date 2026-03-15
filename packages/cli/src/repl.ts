import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
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
} from '@agon/core';
import type { AgonConfig, EngineAdapter, ForgeManifest } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { runForge, runBrainstorm, runTribunal } from '@agon/forge';
import type { Intent } from './intent.js';
import { detectIntent, SLASH_COMMANDS } from './intent.js';
import {
  bold,
  dim,
  cyan,
  green,
  red,
  yellow,
  blue,
  magenta,
  white,
  italic,
  fg256,
  header,
  success,
  fail,
  warn,
  info,
  table,
} from './output.js';

const VERSION = '0.1.0';

let registry: EngineRegistry;
let adapter: EngineAdapter;

// Session-level engine selection. null = use all available.
let sessionEngines: string[] | null = null;

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

// ── Dashboard ────────────────────────────────────────────────────────

// Gradient: orange → yellow → white for the Agon logo
const LOGO_COLORS = [208, 214, 220, 226, 228, 230, 255];

function gradientText(text: string, colors: number[]): string {
  let result = '';
  const step = Math.max(1, Math.floor(text.length / colors.length));
  for (let i = 0; i < text.length; i++) {
    const colorIdx = Math.min(Math.floor(i / step), colors.length - 1);
    result += fg256(colors[colorIdx], text[i]);
  }
  return result;
}

// Engine-specific brand colors (256-color palette)
const ENGINE_COLORS: Record<string, number> = {
  claude: 208,    // orange (Anthropic)
  codex: 34,      // green (OpenAI)
  gemini: 33,     // blue (Google)
  ollama: 255,    // white (local)
  aider: 141,     // purple
  openrouter: 197, // pink
  qwen: 45,       // teal
  mistral: 75,    // light blue
};

function renderDashboard(): void {
  const available = registry.availableIds();
  const allEngines = registry.list();
  const elo = getElo();

  // ── ASCII Art Logo ──
  const logo = [
    '   ▄▀█ ▄▀▀ ▄▀▄ █▄ █',
    '   █▀█ ▀▄█ ▀▄▀ █ ▀█',
  ];

  console.log('');
  for (const line of logo) {
    console.log(`  ${gradientText(line, LOGO_COLORS)}`);
  }
  console.log(`  ${dim(`  v${VERSION} — Competitive AI Orchestration`)}`);
  console.log('');

  // ── Engine Status Bar ──
  console.log(`  ${bold(white('ENGINES'))}`);
  console.log(`  ${dim('─'.repeat(48))}`);

  for (const engine of allEngines) {
    const isAvail = registry.isAvailable(engine);
    const color = ENGINE_COLORS[engine.id] ?? 245;
    const rating = getEngineRating(engine.id);
    const dot = isAvail ? fg256(color, '●') : fg256(240, '○');
    const name = isAvail
      ? fg256(color, bold(engine.id.padEnd(12)))
      : fg256(240, engine.id.padEnd(12));
    const status = isAvail ? fg256(color, 'ready') : dim('missing');
    const eloStr = rating.wins + rating.losses > 0
      ? dim(` ELO ${rating.rating}`)
      : '';

    console.log(`  ${dot} ${name} ${status}${eloStr}`);
  }
  console.log('');

  // ── ELO Leader ──
  const totalMatches = Object.values(elo.global).reduce(
    (sum, r) => sum + r.wins + r.losses,
    0,
  );
  if (totalMatches > 0) {
    const sorted = Object.entries(elo.global).sort(
      ([, a], [, b]) => b.rating - a.rating,
    );
    const [topId, topRating] = sorted[0];
    const topColor = ENGINE_COLORS[topId] ?? 255;
    console.log(`  ${fg256(220, '♛')} Leader: ${fg256(topColor, bold(topId))} ${dim(`(${topRating.rating} ELO, ${topRating.wins}W/${topRating.losses}L)`)}`);
  } else {
    console.log(`  ${dim('No forges yet — engines await their first battle')}`);
  }
  console.log('');

  // ── Quick Start ──
  console.log(`  ${bold(white('JUST TYPE'))}  ${dim('— Agon figures out the rest')}`);
  console.log(`  ${dim('─'.repeat(48))}`);
  console.log(`  ${fg256(214, '⚔')}  ${italic('"fix the login bug, test with npm test"')}`);
  console.log(`  ${fg256(33, '⚖')}  ${italic('"should we use REST or GraphQL?"')}`);
  console.log(`  ${fg256(141, '💡')} ${italic('"best approach for caching?"')}`);
  console.log(`  ${fg256(245, '📊')} ${italic('"leaderboard"  "history"  "engines"')}`);
  console.log('');
  console.log(`  ${dim('Type / for slash commands, /use <engines> to select engines')}`);
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
  header('Slash Commands');
  console.log('');
  for (const { cmd, desc } of SLASH_COMMANDS) {
    console.log(`  ${fg256(214, bold(cmd.padEnd(16)))}${dim(desc)}`);
  }
  console.log('');
}

// ── Helpers ──────────────────────────────────────────────────────────

async function askQuestion(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ── Forge ────────────────────────────────────────────────────────────

async function handleForge(
  task: string,
  fitnessCmd: string | null,
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
  ensureAgonHome();

  if (!task) {
    warn('No task provided. Usage: "fix the auth bug, test with npm test"');
    return;
  }

  let fitness = fitnessCmd;
  if (!fitness) {
    fitness = await askQuestion(rl, `  ${yellow('▸')} What command tests this? `);
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

  const engineList = engines.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(', '));
  console.log(`  ${cyan('▸')} Forge: ${bold(task)}`);
  console.log(`  ${cyan('▸')} Fitness: ${fitness}`);
  console.log(`  ${cyan('▸')} Engines: ${engineList}`);
  const answer = await askQuestion(rl, `  Proceed? ${dim('[Y/n]')} `);
  if (answer.trim().toLowerCase() === 'n') {
    info('Cancelled.');
    return;
  }

  const forgeDir = join(RUNS_DIR, `forge-${Date.now()}`);
  mkdirSync(forgeDir, { recursive: true });

  console.log('');
  const manifest = await runForge(
    {
      task,
      fitnessCmd: fitness,
      cwd: process.cwd(),
      forgeDir,
      engines,
    },
    registry,
    adapter,
    (event) => {
      switch (event.type) {
        case 'baseline:start':
          info('Running baseline preflight...');
          break;
        case 'baseline:done':
          if (event.data?.passes) {
            warn('Baseline passes — fitness test may be non-discriminating');
          }
          break;
        case 'stage1:dispatch':
          info(`Stage 1: ${bold(event.engineId ?? 'starter')} dispatched...`);
          break;
        case 'stage1:accepted':
          success(
            `Stage 1 auto-accepted: ${event.engineId} (score: ${event.data?.score})`,
          );
          break;
        case 'stage2:dispatch':
          info(`Stage 2: ${bold(event.engineId ?? 'challenger')} dispatched...`);
          break;
        case 'winner:determined':
          if (event.data?.winner) {
            success(
              `Winner: ${bold(String(event.data.winner))} (score: ${event.data.bestScore})`,
            );
          } else {
            fail('No engine passed the fitness test');
          }
          break;
        case 'synthesis:done':
          if (event.data?.wins) {
            success(
              `Synthesis improved: ${event.data.originalScore} → ${event.data.score}`,
            );
          }
          break;
      }
    },
  );

  console.log('');
  header('Results');
  const rows = Object.entries(manifest.results).map(([id, r]) => [
    id === manifest.winner ? green(`★ ${id}`) : id,
    r.pass ? green('PASS') : red('FAIL'),
    String(r.score),
    String(r.diffLines),
    String(r.filesChanged),
    `${r.durationSec}s`,
  ]);
  table(['Engine', 'Status', 'Score', 'Diff', 'Files', 'Time'], rows);

  console.log('');
  if (manifest.winner) {
    success(`Winner: ${bold(manifest.winner)}`);
    info(`Patch: ${manifest.patches[manifest.winner]}`);
  } else {
    fail('No winner — all engines failed');
  }
  info(`Manifest: ${forgeDir}/manifest.json`);
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

  const engineList = engines.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(', '));
  header(`Brainstorm: ${question}`);
  info(`Engines: ${engineList}`);
  info('Dispatching engines for confidence bids...');

  const result = await runBrainstorm({
    question,
    engines,
    registry,
    adapter,
    timeout: 120,
    outputDir,
  });

  console.log('');
  header('Bids');
  const rows = result.bids.map((b) => [
    b.engineId === result.winner ? green(`★ ${b.engineId}`) : b.engineId,
    String(b.confidence),
    b.reasoning.slice(0, 60),
  ]);
  table(['Engine', 'Confidence', 'Reasoning'], rows);

  console.log('');
  info(`Winner (highest confidence): ${bold(result.winner)} — fetching full response...`);
  console.log('');
  header(`Response from ${bold(result.winner)}`);
  console.log(result.response);
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

  const engineList = engines.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(', '));
  header(`Tribunal: ${question}`);
  info(`Engines: ${engineList}`);
  info('Rounds: 2');
  console.log('');

  const result = await runTribunal({
    question,
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
          info(
            `Round ${event.data.round}: ${bold(String(engineId))} (${String(position)}) arguing...`,
          );
        }
      }
    },
  });

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
  const engines = registry.list();
  const rows: string[][] = [];

  for (const engine of engines) {
    const available = registry.isAvailable(engine);
    const version = available
      ? ((await adapter.getVersion(engine)) ?? dim('unknown'))
      : '';
    rows.push([
      available ? green(engine.id) : red(engine.id),
      engine.displayName,
      available ? green('installed') : red('missing'),
      version,
      engine.tier,
    ]);
  }
  table(['ID', 'Name', 'Status', 'Version', 'Tier'], rows);
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

// ── REPL Loop ────────────────────────────────────────────────────────

export async function startRepl(): Promise<void> {
  ensureAgonHome();
  initRegistry();

  renderDashboard();

  // Tab completion for slash commands
  const slashNames = SLASH_COMMANDS.map((c) => c.cmd);
  function completer(line: string): [string[], string] {
    if (line.startsWith('/')) {
      const hits = slashNames.filter((c) => c.startsWith(line));
      return [hits.length ? hits : slashNames, line];
    }
    return [[], line];
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(),
    completer,
  });

  function buildPrompt(): string {
    const base = `  ${fg256(208, '⚔')} ${bold(white('agon'))}`;
    if (sessionEngines) {
      const tag = sessionEngines.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(','));
      return `${base} ${dim('[')}${tag}${dim(']')} ${fg256(214, '❯')} `;
    }
    return `${base} ${fg256(214, '❯')} `;
  }

  function refreshPrompt(): void {
    rl.setPrompt(buildPrompt());
  }

  let busy = false;

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Prevent overlapping commands
    if (busy) {
      warn('A command is running. Please wait...');
      return;
    }

    const intent = detectIntent(input);

    busy = true;
    rl.pause();

    try {
      switch (intent.type) {
        case 'forge':
          await handleForge(intent.task, intent.fitnessCmd, rl);
          break;
        case 'brainstorm':
          await handleBrainstorm(intent.question);
          break;
        case 'tribunal':
          await handleTribunal(intent.question);
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
        case 'config':
          handleConfig(intent);
          break;
        case 'use':
          handleUse(intent.engineIds);
          break;
        case 'slash-list':
          showSlashList();
          break;
        case 'help':
          showHelp();
          break;
        case 'exit':
          console.log(`\n  ${dim('Goodbye.')}\n`);
          rl.close();
          return;
        case 'unknown':
          console.log('');
          console.log(
            `  ${yellow('?')} Not sure what to do with that. Should I:`,
          );
          console.log(`    ${bold('/forge')} "${intent.input}"    — engines race to solve`);
          console.log(`    ${bold('/brainstorm')} "${intent.input}" — brainstorm ideas`);
          console.log(`    ${bold('/tribunal')} "${intent.input}"  — debate it`);
          console.log('');
          console.log(`  ${dim('Or type /help for all commands.')}`);
          break;
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }

    busy = false;
    rl.resume();
    refreshPrompt();
    console.log('');
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });

  rl.on('SIGINT', () => {
    console.log(`\n  ${dim('Goodbye.')}\n`);
    rl.close();
  });
}
