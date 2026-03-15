import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  external: ['@agon/core', '@agon/forge', '@agon/adapter-cli'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
