import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { downloadCaesar } from './caesar.js';
import {
  EngineRegistry,
  ensureAgonHome,
  configSet,
  AGON_HOME,
} from '@agon/core';
import type { EngineAdapter } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import {
  bold,
  dim,
  green,
  white,
  italic,
  fg256,
  success,
  fail,
  warn,
  info,
  LOGO_COLORS,
  ENGINE_COLORS,
  gradientText,
} from './output.js';

const CAESAR_MODELS = [
  {
    id: 'smollm2-360m' as const,
    name: 'SmolLM2-360M',
    size: '~200MB',
    desc: 'Fast, lightweight — great for routing and summaries',
    recommended: true,
  },
  {
    id: 'phi-3-mini' as const,
    name: 'Phi-3 Mini',
    size: '~2GB',
    desc: 'Smarter, deeper reasoning — better for tribunal verdicts',
    recommended: false,
  },
  {
    id: 'none' as const,
    name: 'No Caesar',
    size: '',
    desc: 'Use keyword matching instead (always works, no download)',
    recommended: false,
  },
];

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function runOnboarding(): Promise<void> {
  ensureAgonHome();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const logo = [
    '   ▄▀█ ▄▀▀ ▄▀▄ █▄ █',
    '   █▀█ ▀▄█ ▀▄▀ █ ▀█',
  ];

  console.log('');
  for (const line of logo) {
    console.log(`  ${gradientText(line, LOGO_COLORS)}`);
  }
  console.log(`  ${italic('   Any AI can join. They compete. You ship.')}`);
  console.log('');
  console.log(`  ${bold(white('Welcome to Agon!'))} Let's get you set up.`);
  console.log('');

  // ── Step 1: Engines ──
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log(`  ${bold(white('STEP 1'))}  ${dim('Engines')}`);
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log('');

  const registry = new EngineRegistry();
  const enginesDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../engines',
  );
  registry.load(enginesDir);
  const adapter = createCliAdapter(registry);

  const allEngines = registry.list();
  const available: string[] = [];
  const versions: Record<string, string> = {};

  // Scan all engines in parallel — show spinner while scanning
  process.stdout.write(`  ${dim('Scanning engines...')}`);

  const scanResults = await Promise.all(
    allEngines.map(async (engine) => {
      const isAvail = registry.isAvailable(engine);
      let version = '';
      if (isAvail) {
        version = (await adapter.getVersion(engine)) ?? '';
      }
      return { engine, isAvail, version };
    }),
  );

  // Clear the "Scanning..." line and show results
  process.stdout.write('\r\x1b[2K');

  for (const { engine, isAvail, version } of scanResults) {
    const color = ENGINE_COLORS[engine.id] ?? 245;
    if (isAvail) {
      available.push(engine.id);
      versions[engine.id] = version;
      console.log(`  ${fg256(color, '●')} ${fg256(color, bold(engine.id.padEnd(14)))} ${green('ready')}  ${dim(version)}`);
    } else {
      console.log(`  ${fg256(240, '○')} ${fg256(240, engine.id.padEnd(14))} ${dim('not installed')}`);
    }
  }

  console.log('');
  if (available.length === 0) {
    fail('No engines found. Install at least one AI CLI tool.');
    info('Supported: claude, codex, gemini, ollama');
  } else {
    success(`${available.length} engines found`);
  }

  // Let user pick which engines to enable
  if (available.length > 0) {
    console.log('');
    console.log(`  ${dim('Which engines should compete? Enter numbers separated by commas.')}`);
    console.log(`  ${dim('Press Enter to use all.')}`);
    console.log('');
    for (let i = 0; i < available.length; i++) {
      const id = available[i];
      const color = ENGINE_COLORS[id] ?? 245;
      console.log(`  ${bold(String(i + 1))}. ${fg256(color, bold(id))}  ${dim(versions[id] ?? '')}`);
    }
    console.log('');
    const engineChoice = await ask(rl, `  ${fg256(214, '❯')} Engines ${dim(`[1-${available.length}, default: all]`)}: `);
    const trimmed = engineChoice.trim();

    let selected: string[];
    if (!trimmed) {
      selected = available;
    } else {
      const indices = trimmed.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10) - 1);
      selected = indices
        .filter((i) => i >= 0 && i < available.length)
        .map((i) => available[i]);
      if (selected.length === 0) selected = available;
    }

    configSet('forgeEnabledEngines', selected);
    const tags = selected.map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(dim(', '));
    success(`Active engines: ${tags}`);
  }

  // ── Step 2: Caesar ──
  console.log('');
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log(`  ${bold(white('STEP 2'))}  ${dim('Caesar — your local orchestrator')}`);
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log('');
  console.log(`  Caesar is a small AI that runs ${bold('100% on your machine')}.`);
  console.log(`  It routes commands, summarizes results, and judges debates.`);
  console.log(`  ${green('Apache 2.0')} license — free for commercial use.`);
  console.log(`  ${green('No data leaves your machine')} — ever.`);
  console.log('');

  for (let i = 0; i < CAESAR_MODELS.length; i++) {
    const m = CAESAR_MODELS[i];
    const num = `${i + 1}`;
    const rec = m.recommended ? fg256(214, ' ★ recommended') : '';
    const size = m.size ? dim(` (${m.size})`) : '';
    console.log(`  ${bold(num)}. ${bold(white(m.name))}${size}${rec}`);
    console.log(`     ${dim(m.desc)}`);
  }

  console.log('');
  const caesarChoice = await ask(rl, `  ${fg256(214, '❯')} Choose Caesar model ${dim('[1/2/3, default: 1]')}: `);
  const caesarIdx = parseInt(caesarChoice.trim() || '1', 10) - 1;
  const selectedCaesar = CAESAR_MODELS[caesarIdx] ?? CAESAR_MODELS[0];

  if (selectedCaesar.id !== 'none') {
    console.log('');
    console.log(`  ${dim('Downloading')} ${bold(selectedCaesar.name)}${dim('...')}`);
    console.log(`  ${dim('This runs 100% locally. No data leaves your machine.')}`);
    console.log('');

    let lastFile = '';
    const ok = await downloadCaesar(selectedCaesar.id, (progress) => {
      if (progress.status === 'download' && progress.progress !== undefined) {
        const pct = Math.round(progress.progress);
        const filled = '█'.repeat(Math.floor(pct / 5));
        const empty = '░'.repeat(20 - Math.floor(pct / 5));
        process.stdout.write(`\r  ${fg256(214, filled)}${dim(empty)} ${dim(`${pct}%`)}`);
      } else if (progress.status === 'initiate') {
        const file = (progress as Record<string, unknown>).file as string | undefined;
        if (file && file !== lastFile) {
          lastFile = file;
          process.stdout.write(`\r\x1b[2K  ${dim(`Fetching ${file}...`)}`);
        }
      }
    });

    process.stdout.write('\r\x1b[2K');
    if (ok) {
      success(`${selectedCaesar.name} ready`);
      info('Model stored in ~/.agon/models/');
    } else {
      warn(`Could not download ${selectedCaesar.name} — using keyword matching instead`);
      configSet('caesarModel', 'none');
    }
  } else {
    success('Using keyword matching — no model needed');
  }

  configSet('caesarModel', selectedCaesar.id);

  await ask(rl, `\n  ${dim('Press Enter to continue...')} `);

  // ── Step 3: Project Context ──
  console.log('');
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log(`  ${bold(white('STEP 3'))}  ${dim('Project context (optional)')}`);
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log('');
  console.log(`  Give Caesar some context about your project so it`);
  console.log(`  can make smarter routing decisions.`);
  console.log('');
  console.log(`  ${dim('Examples:')}`);
  console.log(`  ${dim('  "E-commerce API in TypeScript, Prisma + Redis"')}`);
  console.log(`  ${dim('  "React Native mobile app with Expo"')}`);
  console.log(`  ${dim('  "Rust game engine with ECS architecture"')}`);
  console.log('');

  const context = await ask(rl, `  ${fg256(214, '❯')} What does your project do? ${dim('(Enter to skip)')} `);
  const trimmedContext = context.trim();

  if (trimmedContext) {
    configSet('projectContext', trimmedContext);
    const contextPath = join(AGON_HOME, 'context.md');
    writeFileSync(contextPath, `# Project Context\n\n${trimmedContext}\n`);
    success(`Saved to ~/.agon/context.md`);
  } else {
    info('Skipped — you can add context later with /config set projectContext "..."');
  }

  // ── Done ──
  configSet('onboarded', true);

  console.log('');
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log(`  ${bold(white("You're all set!"))}`);
  console.log(`  ${fg256(214, '━'.repeat(48))}`);
  console.log('');

  const summary: string[] = [];
  summary.push(`  ${green('●')} ${bold(`${available.length} engines`)} ready to compete`);
  summary.push(`  ${green('●')} Caesar: ${bold(selectedCaesar.name)}${selectedCaesar.id !== 'none' ? ' (local)' : ''}`);
  if (trimmedContext) {
    summary.push(`  ${green('●')} Context: ${dim(trimmedContext.slice(0, 50))}${trimmedContext.length > 50 ? dim('...') : ''}`);
  }
  for (const line of summary) console.log(line);

  console.log('');
  console.log(`  ${dim('Type naturally or / for commands. Have fun!')}`);
  console.log('');

  rl.close();
}
