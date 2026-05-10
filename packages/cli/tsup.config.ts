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
  external: [
    '@agon/core', '@agon/forge', '@agon/adapter-cli',
    '@huggingface/transformers', 'onnxruntime-node',
    'ink', 'react', 'ink-text-input', 'ink-spinner', 'ink-select-input',
    'chalk', 'supports-color',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
  async onSuccess() {
    copyEngines(join(process.cwd(), 'dist'));
  },
});
