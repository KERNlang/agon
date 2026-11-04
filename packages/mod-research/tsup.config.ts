import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/index.ts', 'src/prompt-policy.ts', 'src/format-policy.ts', 'src/response-policy.ts', 'src/discovery-policy.ts', 'src/query-policy.ts', 'src/citation-policy.ts'], external: ['./prompt-policy.js', './format-policy.js', './response-policy.js', './discovery-policy.js', './query-policy.js', './citation-policy.js'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });
