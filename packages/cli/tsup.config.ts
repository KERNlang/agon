import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function copyEngines(outDir: string) {
  const src = join(process.cwd(), '..', '..', 'engines');
  const dest = join(outDir, 'engines');
  mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(src)) {
    if (file.endsWith('.json')) {
      copyFileSync(join(src, file), join(dest, file));
    }
  }
}

export default defineConfig({
  // Two entries from ONE build: the CLI itself, and the agon-orchestration MCP
  // server (../mcp/src/index.ts) emitted to dist/mcp/index.js. Bundling the MCP
  // server in keeps `npm i -g @kernlang/agon` self-contained — Cesar spawns the
  // bundled copy (see resolveAgonMcpServerPath) instead of an unpublished
  // @kernlang/agon-mcp dependency. Both entries inline agon-core and share chunks.
  entry: { index: 'src/index.ts', 'mcp/index': '../mcp/src/index.ts' },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  // Ship source MAPS (so the runtime stack-trace mapper can resolve dist → src
  // file:line for readable error frames) but NOT the embedded original source.
  // sourcesContent:false strips the full .ts/.kern-generated source from the
  // published .js.map — otherwise `npm i -g @kernlang/agon` would carry the
  // entire codebase, defeating the private-repo posture and doubling pkg size.
  esbuildOptions(options) {
    options.sourcesContent = false;
  },
  clean: true,
  // @kernlang/agon-core, @kernlang/agon-forge, @kernlang/agon-adapter-cli are INLINED (pure JS) so a bare
  // `npm i -g @kernlang/agon` is self-contained — they are deliberately NOT external.
  // @kernlang/agon-engines + @kernlang/agon-dedup stay external: both are loaded at RUNTIME
  // (dynamic import / require.resolve of spawned .py twins) and published as
  // their own packages, so esbuild must not try to bundle them.
  external: [
    '@kernlang/agon-engines', '@kernlang/agon-dedup',
    '@huggingface/transformers', 'onnxruntime-node',
    'ink', 'react', 'ink-text-input', 'ink-spinner', 'ink-select-input',
    'chalk', 'supports-color',
    // Heavy SDK / native-ish deps kept external + declared as runtime deps,
    // so they install from the registry rather than inlining (avoids React
    // singleton + AI-SDK duplication hazards).
    'ai', '@ai-sdk/anthropic', '@ai-sdk/openai-compatible',
    '@kernlang/protocol', '@kernlang/terminal', 'citty', 'pidusage',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
  async onSuccess() {
    copyEngines(join(process.cwd(), 'dist'));
    // The bundled MCP server resolves engines via <its-own-dir>/engines
    // (resolveBuiltinEnginesDir), so it needs a copy next to dist/mcp/index.js —
    // otherwise the spawned server starts with ZERO engines and Cesar silently
    // loses its orchestration tools.
    copyEngines(join(process.cwd(), 'dist', 'mcp'));
  },
});
