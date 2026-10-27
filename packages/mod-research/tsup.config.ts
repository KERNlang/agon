import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/index.ts', 'src/prompt-policy.ts'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });
