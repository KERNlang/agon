import { defineConfig } from 'tsup';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

export default defineConfig({
  // Two entries from ONE build: the CLI itself, and the agon-orchestration MCP
  // server (../mcp/src/index.ts) emitted to dist/mcp/index.js. Bundling the MCP
  // server in keeps `npm i -g @kernlang/agon` self-contained — Cesar spawns the
  // bundled copy (see resolveAgonMcpServerPath) instead of an unpublished
  // @kernlang/agon-mcp dependency. Both entries inline agon-core and share chunks.
  // A third entry: the Chrome native-messaging pairing host launcher, emitted to
  // dist/browser-host.js. The com.kernlang.agon manifest's `path` points here;
  // Chrome execs it directly (banner shebang + `browser-host install` chmod +x).
  entry: { index: 'src/index.ts', 'mcp/index': '../mcp/src/index.ts', 'browser-host': 'src/browser-host-entry.ts' },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  // Ship source MAPS (so error frames resolve dist → src file:line) but NOT
  // the embedded original source. sourcesContent:false strips the full .ts
  // source from the published .js.map — otherwise `npm i -g @kernlang/agon` would carry the
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
    '@kernlang/agon-engines', '@kernlang/agon-dedup', '@kernlang/agon-mod-api',
    '@kernlang/agon-kernel',
    '@kernlang/agon-support-agent-runtime', '@kernlang/agon-support-browser-bridge',
    '@kernlang/agon-support-dedup', '@kernlang/agon-support-engine-catalog',
    '@kernlang/agon-support-engine-runtime', '@kernlang/agon-support-judge',
    '@kernlang/agon-support-panel', '@kernlang/agon-support-persistence',
    '@kernlang/agon-support-saas-api', '@kernlang/agon-support-verification',
    '@kernlang/agon-support-worktree',
    '@huggingface/transformers', 'onnxruntime-node',
    'ink', 'react', 'ink-text-input', 'ink-spinner', 'ink-select-input',
    'chalk', 'supports-color',
    // Heavy SDK / native-ish deps kept external + declared as runtime deps,
    // so they install from the registry rather than inlining (avoids React
    // singleton + AI-SDK duplication hazards).
    'ai', '@ai-sdk/anthropic', '@ai-sdk/openai-compatible',
    '@kernlang/protocol', 'citty', 'pidusage',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
  async onSuccess() {
    copyFileSync(join(process.cwd(), 'release-channel.json'), join(process.cwd(), 'dist', 'release-channel.json'));
  },
});
