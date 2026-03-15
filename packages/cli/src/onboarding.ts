import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import * as p from '@clack/prompts';
import { downloadCaesar } from './caesar.js';
import {
  EngineRegistry,
  ensureAgonHome,
  configSet,
  AGON_HOME,
} from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import {
  bold,
  dim,
  green,
  white,
  italic,
  fg256,
  LOGO_COLORS,
  ENGINE_COLORS,
  gradientText,
} from './output.js';

export async function runOnboarding(): Promise<void> {
  ensureAgonHome();

  // ── Logo ──
  const logo = [
    '   ▄▀█ ▄▀▀ ▄▀▄ █▄ █',
    '   █▀█ ▀▄█ ▀▄▀ █ ▀█',
  ];
  console.log('');
  for (const line of logo) {
    console.log(`  ${gradientText(line, LOGO_COLORS)}`);
  }
  console.log(`  ${italic('   Any AI can join. They compete. You ship.')}`);
  console.log(`  ${dim('   Powered by')} ${bold(fg256(220, 'KERNlang'))}`);
  console.log('');

  p.intro(bold(white('Welcome to Agon!')));

  // ── Step 1: Engine scan ──
  const registry = new EngineRegistry();
  const enginesDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../engines',
  );
  registry.load(enginesDir);
  const adapter = createCliAdapter(registry);

  const allEngines = registry.list();
  const spin = p.spinner();
  spin.start('Scanning engines...');

  const engineData = await Promise.all(
    allEngines.map(async (engine) => {
      const isAvail = registry.isAvailable(engine);
      const version = isAvail ? ((await adapter.getVersion(engine)) ?? '') : '';
      return { id: engine.id, isAvail, version, displayName: engine.displayName };
    }),
  );

  const available = engineData.filter((e) => e.isAvail);
  spin.stop(`${available.length} engines found`);

  // ── Step 1b: Choose engines ──
  if (available.length > 0) {
    const selected = await p.multiselect({
      message: 'Which engines should compete?',
      options: available.map((e) => ({
        value: e.id,
        label: `${fg256(ENGINE_COLORS[e.id] ?? 245, bold(e.id))}`,
        hint: e.version,
      })),
      initialValues: available.map((e) => e.id),
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Setup cancelled.');
      throw new Error('cancelled');
    }

    configSet('forgeEnabledEngines', selected as string[]);
    p.log.success(`Active: ${(selected as string[]).map((id) => fg256(ENGINE_COLORS[id] ?? 245, id)).join(', ')}`);
  } else {
    p.log.warn('No engines found. Install claude, codex, gemini, or ollama.');
  }

  // ── Step 2: Caesar model ──
  p.log.info(`Caesar saves you ${bold('~70% on API costs')} by handling translation locally.
  ${dim('Small AI on your machine. No data leaves. Free forever.')}`);

  const caesarChoice = await p.select({
    message: 'Choose your Caesar model',
    options: [
      {
        value: 'smollm2-360m',
        label: `${bold('SmolLM2-135M')} ${dim('(~70MB)')} ${fg256(214, '★ recommended')}`,
        hint: 'Tiny, instant — great for routing',
      },
      {
        value: 'qwen-0.5b',
        label: `${bold('Qwen2.5-0.5B')} ${dim('(~300MB)')}`,
        hint: 'Smarter, better for summaries and tribunal verdicts',
      },
      {
        value: 'none',
        label: bold('Skip (not recommended)'),
        hint: 'No translation, no token savings — engines respond in verbose mode',
      },
    ],
    initialValue: 'smollm2-360m',
  });

  if (p.isCancel(caesarChoice)) {
    p.cancel('Setup cancelled.');
    throw new Error('cancelled');
  }

  const selectedModel = caesarChoice as string;

  if (selectedModel !== 'none') {
    const modelName = selectedModel === 'smollm2-360m' ? 'SmolLM2-360M' : 'Phi-3 Mini';
    const dl = p.spinner();
    dl.start(`Downloading ${modelName}...`);

    const ok = await downloadCaesar(selectedModel, (progress) => {
      if (progress.status === 'download' && progress.progress !== undefined) {
        dl.message(`Downloading ${modelName}... ${Math.round(progress.progress)}%`);
      } else if (progress.status === 'initiate') {
        const file = (progress as Record<string, unknown>).file as string | undefined;
        if (file) dl.message(`Fetching ${file}...`);
      }
    });

    if (ok) {
      dl.stop(`${modelName} ready — stored in ~/.agon/models/`);
    } else {
      dl.stop(`Could not download ${modelName} — using keyword matching`);
      configSet('caesarModel', 'none');
    }
  }

  configSet('caesarModel', selectedModel as 'smollm2-360m' | 'phi-3-mini' | 'none');

  // ── Done ──
  configSet('onboarded', true);

  p.outro(bold(white("You're all set! Type naturally or / for commands.")));
}
