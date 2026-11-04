import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/index.ts', 'src/lexical-policy.ts', 'src/workflow.ts'], external: ['./lexical-policy.js', './workflow.js'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });
