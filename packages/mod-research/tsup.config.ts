import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/index.ts', 'src/response-policy.ts'], external: ['./response-policy.js'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });
