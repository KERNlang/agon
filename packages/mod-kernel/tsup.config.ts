import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/third-party-worker-runner.mjs'],
  format: ['esm'],
  dts: false,
  sourcemap: false,
  clean: true,
  external: ['@kernlang/agon-mod-api'],
});
