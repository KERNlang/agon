import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/index.ts', 'src/text-forensics.ts'], external: ['./text-forensics.js'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });
