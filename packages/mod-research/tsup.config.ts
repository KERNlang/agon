import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/index.ts', 'src/discovery-policy.ts'], external: ['./discovery-policy.js'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });
