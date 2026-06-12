import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { modeDocsMarkdown, agentGuideMarkdown } from '../../packages/cli/src/generated/commands/agent-guide-text.js';

const DOC_PATH = fileURLToPath(new URL('../../docs/modes.md', import.meta.url));

describe('docs/modes.md — generated mode page', () => {
  it('is in sync with the canonical agent guide (regenerate: npm run docs:modes)', () => {
    expect(readFileSync(DOC_PATH, 'utf-8')).toBe(modeDocsMarkdown());
  });

  it('embeds the full guide verbatim — single source of truth', () => {
    expect(modeDocsMarkdown()).toContain(agentGuideMarkdown());
    expect(modeDocsMarkdown()).toContain('GENERATED — do not edit');
  });

  it('carries the escalation ladder so RAG can answer "which mode when"', () => {
    expect(modeDocsMarkdown()).toContain('Escalation ladder');
    for (const mode of ['nero', 'tribunal', 'council', 'conquer']) {
      expect(modeDocsMarkdown()).toContain(`\`${mode}\``);
    }
  });
});
