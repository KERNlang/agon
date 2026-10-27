import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/index.ts', 'src/query-policy.ts'], external: ['./query-policy.js'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });
