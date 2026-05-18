import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts', 'cli/claude.ts', 'cli/session.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
});
