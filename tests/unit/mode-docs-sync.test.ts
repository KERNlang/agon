import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { agentGuideMarkdown, renderModeDocsProjection } from '../../packages/mod-routing-docs/src/guide-content.js';
import { FIRST_PARTY_SURFACE_CATALOG } from '../../packages/mod-kernel/src/generated/first-party-surface-catalog.js';

const DOC_PATH = fileURLToPath(new URL('../../docs/modes.md', import.meta.url));

describe('docs/modes.md — generated mode page', () => {
  it('is in sync with the canonical agent guide (regenerate: npm run docs:modes)', () => {
    const current = readFileSync(DOC_PATH, 'utf-8');
    expect(current).toBe(renderModeDocsProjection(FIRST_PARTY_SURFACE_CATALOG, current));
  });

  it('embeds the full guide verbatim — single source of truth', () => {
    const rendered = renderModeDocsProjection(FIRST_PARTY_SURFACE_CATALOG);
    expect(rendered).toContain(agentGuideMarkdown());
    expect(rendered).toContain('GENERATED from the selected owner-tagged registry');
  });

  it('carries the escalation ladder so RAG can answer "which mode when"', () => {
    const rendered = renderModeDocsProjection(FIRST_PARTY_SURFACE_CATALOG);
    expect(rendered).toContain('Escalation ladder');
    for (const mode of ['nero', 'tribunal', 'council', 'conquer']) {
      expect(rendered).toContain(`\`${mode}\``);
    }
  });
});
