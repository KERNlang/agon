// Regenerate docs/modes.md from the canonical agent guide so the RAG docs
// corpus answers mode questions with citations. Single source of truth:
// packages/cli/src/kern/commands/agent-guide-text.kern (modeDocsMarkdown),
// reached through the built CLI (`agent-guide --docs`) because the cli dist
// is bundled into chunks with no per-module entry points.
// Run AFTER a build: npm run docs:modes. A unit test guards against drift.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'packages/cli/dist/index.js');
const content = execFileSync(process.execPath, [cli, 'agent-guide', '--docs'], {
  encoding: 'utf-8',
  maxBuffer: 8 * 1024 * 1024,
});

const out = join(root, 'docs', 'modes.md');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, content);
console.log(`wrote ${out}`);
