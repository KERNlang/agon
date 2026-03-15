import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  external: ['@agon/core', '@agon/forge', '@agon/adapter-cli', '@huggingface/transformers', 'onnxruntime-node', '@clack/prompts', '@clack/core'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
