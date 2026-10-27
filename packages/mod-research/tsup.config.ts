import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/index.ts', 'src/prompt-policy.ts', 'src/format-policy.ts', 'src/response-policy.ts', 'src/discovery-policy.ts', 'src/query-policy.ts'], external: ['./query-policy.js'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });
