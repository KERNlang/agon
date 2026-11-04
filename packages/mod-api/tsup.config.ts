import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/manifest.ts', 'src/state.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: false,
  clean: true,
});
