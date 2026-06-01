import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function copyEngines(outDir: string) {
  const src = join(process.cwd(), '..', '..', 'engines');
  const dest = join(outDir, 'engines');
  mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(src)) {
    if (file.endsWith('.json')) {
      copyFileSync(join(src, file), join(dest, file));
    }
  }
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  // @agon/core, @agon/forge, @agon/adapter-cli are INLINED (pure JS) so a bare
  // `npm i -g @agon/cli` is self-contained — they are deliberately NOT external.
  // @agon/kern-engines + @agon/dedup stay external: both are loaded at RUNTIME
  // (dynamic import / require.resolve of spawned .py twins) and published as
  // their own packages, so esbuild must not try to bundle them.
  external: [
    '@agon/kern-engines', '@agon/dedup',
    '@huggingface/transformers', 'onnxruntime-node',
    'ink', 'react', 'ink-text-input', 'ink-spinner', 'ink-select-input',
    'chalk', 'supports-color',
    // Heavy SDK / native-ish deps kept external + declared as runtime deps,
    // so they install from the registry rather than inlining (avoids React
    // singleton + AI-SDK duplication hazards).
    'ai', '@ai-sdk/anthropic', '@ai-sdk/openai-compatible',
    '@kernlang/protocol', '@kernlang/terminal', 'citty', 'pidusage',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
  async onSuccess() {
    copyEngines(join(process.cwd(), 'dist'));
  },
});
