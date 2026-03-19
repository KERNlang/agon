import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  external: ['@agon/core', '@agon/forge', '@agon/adapter-cli', '@huggingface/transformers', 'onnxruntime-node', 'ink', 'react', 'ink-text-input', 'ink-spinner', 'ink-select-input'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
