#!/usr/bin/env node
/**
 * REPL typing-smoothness probe.
 *
 * Boots the built REPL on a real PTY (fixed 120x40) inside a throwaway
 * AGON_HOME, seeds a long transcript, types N synthetic keystrokes, and
 * reports:
 *   - render commits per keystroke, per instrumented component
 *     (AGON_RENDER_PROBE=1 -> $AGON_HOME/perf/render-counts.json)
 *   - keystroke -> commit latency p50/p95/max
 *     (AGON_PERF=1 -> $AGON_HOME/perf/input-latency.ndjson)
 *
 * Usage:
 *   node scripts/perf/repl-typing-probe.mjs [--keys 60] [--blocks 300] [--delay 45]
 *
 * Requires a prior `npm run build` (it drives packages/cli/dist/index.js) and
 * python3 (stdlib pty; see scripts/perf/pty-drive.py).
 *
 * ── BASELINE (2026-08-20, feat/repl-input-leaf @ 2ccebb3a, macOS 25.5,
 *    node 22.22, 300 seeded blocks, 60 keystrokes, 120x40, 3 runs) ───────
 *   renders/keystroke : App 1.00 · ComposerView 1.00 · PromptTextInput 2.00
 *   latency ms        : p50 6.46/6.54/6.59 · p95 7.84/8.74/9.99 · max 11.9
 *
 * ── AFTER input-leaf extraction (same box/settings, 3 runs) ──────────────
 *   renders/keystroke : App 0.00 · ComposerView 1.00 · PromptTextInput 2.00
 *   latency ms        : p50 3.66/3.69/3.78 · p95 4.73/7.50/4.61
 *
 *   App no longer commits per keystroke; only the composer leaf does.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return Number(process.argv[index + 1] ?? fallback);
}

const KEYS = arg('keys', 60);
const BLOCKS = arg('blocks', 300);
const DELAY = arg('delay', 45);
const COLS = arg('cols', 120);
const ROWS = arg('rows', 40);

const cliEntry = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
if (!existsSync(cliEntry)) {
  console.error(`[probe] missing ${cliEntry} — run \`npm run build\` first.`);
  process.exit(1);
}

const home = mkdtempSync(join(tmpdir(), 'agon-perf-'));
// Pre-seed the sandbox config so the REPL boots straight into chat instead of
// the first-run onboarding wizard (which would eat every keystroke).
mkdirSync(home, { recursive: true });
writeFileSync(
  join(home, 'config.json'),
  JSON.stringify({
    onboarded: true,
    engineActivationMode: 'explicit',
    forgeEnabledEngines: [],
    forgeFixedStarter: 'claude',
    cesarEngine: 'claude',
    terminalMode: 'native',
    // Suppress every first-run prompt that would otherwise own the keyboard.
    cesarAutoMode: false,
    cesarAutoModePrompted: true,
    isolationMigrationNotified: true,
    resumePausedPlanOnStartup: false,
  }, null, 2),
);
const steps = [];
const push = (step) => steps.push(JSON.stringify(step));

// Boot: dashboard render + lifecycle effects (update check, telemetry poller).
push({ sleep: 4000 });
// Type a realistic sentence, one keystroke at a time. Never starts with '/'
// or '@' (those open pickers and swallow the composer value).
const sentence = 'the quick brown fox jumps over the lazy dog while agon renders ';
for (let index = 0; index < KEYS; index += 1) {
  push({ send: sentence[index % sentence.length], settle: DELAY });
}
push({ sleep: 1200 });
push({ exit: true });

const driver = spawn(
  'python3',
  [join(here, 'pty-drive.py'), String(COLS), String(ROWS), '--', process.execPath, cliEntry],
  {
    cwd: repoRoot,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: {
      ...process.env,
      AGON_HOME: home,
      AGON_PERF: '1',
      AGON_RENDER_PROBE: '1',
      AGON_PERF_SEED_BLOCKS: String(BLOCKS),
      // Keep the probe hermetic: no network update check, no engine probing.
      AGON_NO_UPDATE_CHECK: '1',
      NO_COLOR: undefined,
    },
  },
);

driver.stdin.write(steps.join('\n') + '\n');
driver.stdin.end();

driver.on('exit', () => {
  const latencyPath = join(home, 'perf', 'input-latency.ndjson');
  const rendersPath = join(home, 'perf', 'render-counts.json');

  const samples = existsSync(latencyPath)
    ? readFileSync(latencyPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const counts = existsSync(rendersPath) ? JSON.parse(readFileSync(rendersPath, 'utf8')).counts : {};

  const dts = samples.map((s) => s.dtMs).sort((a, b) => a - b);
  const pct = (p) => (dts.length ? dts[Math.min(dts.length - 1, Math.floor((p / 100) * dts.length))] : NaN);

  // Renders per keystroke = mean delta of the cumulative per-component
  // counters between consecutive keystroke samples. Boot renders sit before
  // the first sample and are excluded by construction.
  const components = [...new Set(samples.flatMap((s) => Object.keys(s.renders ?? {})))].sort();
  const perKeystroke = {};
  for (const component of components) {
    let sum = 0;
    for (let i = 1; i < samples.length; i += 1) {
      sum += (samples[i].renders?.[component] ?? 0) - (samples[i - 1].renders?.[component] ?? 0);
    }
    perKeystroke[component] = samples.length > 1 ? sum / (samples.length - 1) : NaN;
  }

  console.log('\n── REPL typing probe ────────────────────────────────');
  console.log(`seeded blocks       : ${BLOCKS}`);
  console.log(`keystrokes measured : ${samples.length} (requested ${KEYS})`);
  console.log(`live blocks (last)  : ${samples.at(-1)?.live ?? '?'} of ${samples.at(-1)?.blocks ?? '?'}`);
  console.log('renders / keystroke :');
  for (const component of components) {
    console.log(`  ${component.padEnd(18)} ${perKeystroke[component].toFixed(2)}  (${counts[component] ?? 0} total incl. boot)`);
  }
  console.log('keystroke latency ms:');
  console.log(`  p50 ${pct(50)?.toFixed(2)}  p95 ${pct(95)?.toFixed(2)}  max ${dts.at(-1)?.toFixed(2)}`);
  console.log('─────────────────────────────────────────────────────\n');

  if (!process.argv.includes('--keep')) rmSync(home, { recursive: true, force: true });
  else console.log(`[probe] artifacts kept in ${home}`);
});
