import { describe, expect, it } from 'vitest';

import * as engineModule from '../../packages/cli/src/blocks/engine.js';
import { BANNER_INDENT, DASHBOARD_EXAMPLES, DASHBOARD_TAGLINE, EXAMPLE_ARROW_COLUMN, LOGO_LINES, VERSION, logoInkStartPad } from '../../packages/cli/src/blocks/engine.js';
import { renderBlockOwnRows } from '../../packages/cli/src/surfaces/app-rendering.js';

// The REPL banner is Agon's own product identity: version + KERNlang.dev org
// branding. It must NOT advertise a KERN compiler version — Agon's source is
// plain TypeScript, so a "(KERN x.y.z)" chip would be stale, misleading
// branding.
const dashboardRows = () =>
  renderBlockOwnRows(
    { id: 1, event: { type: 'dashboard', enabled: ['claude', 'codex'] } } as any,
    'chat',
    false,
    true,
    96,
    98,
    92,
  );

const rowText = (row: any): string =>
  (row?.segments ?? []).map((segment: any) => String(segment?.text ?? '')).join('');

describe('REPL banner branding', () => {
  it('renders the version line as "v<version> · Powered by KERNlang.dev"', () => {
    const row = dashboardRows().find((r: any) => String(r.key).endsWith('-dash-version'));
    expect(row).toBeDefined();
    expect(rowText(row)).toBe(`${BANNER_INDENT}v${VERSION}  ·  Powered by KERNlang.dev`);
  });

  it('never shows a KERN compiler version anywhere in the banner', () => {
    const all = dashboardRows().map((row: any) => `${rowText(row)}${row.text ?? ''}`).join('\n');
    expect(all).not.toMatch(/\(KERN/i);
    expect(all).toContain('KERNlang.dev');
  });

  it('exports no KERN_VERSION constant', () => {
    expect('KERN_VERSION' in engineModule).toBe(false);
  });
});

// The launch banner is ONE text block under the AGON figlet: tagline, version,
// workspace, engines, examples and the help line all start at the logo's ink
// column. Centering the tagline (the previous attempt) produced three visibly
// different left edges, so the invariant is now flush-left, not balanced. Both
// renderers — DashboardView's JSX and app-rendering's row builder — have drifted
// apart before, so every assertion below pins them to the same column.
const logoInkStartColumn = (rows: any[]): number => {
  const logoRows = rows.filter((row: any) => /-logo-\d+$/.test(String(row.key)));
  expect(logoRows.length).toBe(LOGO_LINES.length);
  return Math.min(...logoRows.map((row: any) => absoluteStart(row)));
};

const absoluteStart = (row: any): number => {
  const text = row.kind === 'gradient' ? String(row.text ?? '') : rowText(row);
  const full = `${' '.repeat(row.paddingLeft ?? 0)}${text}`;
  return full.length - full.trimStart().length;
};

describe('launch banner flush-left edge', () => {
  it('derives the banner indent from the logo ink, never a hand-counted literal', () => {
    const inked = LOGO_LINES.filter((line: string) => line.trim().length > 0);
    const inkStart = Math.min(...inked.map((line: string) => line.length - line.trimStart().length));
    expect(logoInkStartPad()).toBe(inkStart);
    expect(BANNER_INDENT).toBe(' '.repeat(inkStart));
  });

  it('starts every banner text row at exactly the logo ink column', () => {
    const rows = (renderBlockOwnRows(
      { id: 1, event: { type: 'dashboard', enabled: ['claude', 'codex'], workspace: { path: '/tmp/ws' }, eloTop: { id: 'claude', rating: 1721 } } } as any,
      'chat', false, true, 96, 98, 92,
    ) as any[]);
    const inkColumn = logoInkStartColumn(rows);

    const textRows = rows.filter((row: any) => /-dash-(tag|version|workspace|engines|elo|example-\d+|help)$/.test(String(row.key)));
    // tagline, version, workspace, engines, elo, 4 examples, help
    expect(textRows.length).toBe(10);
    for (const row of textRows) {
      expect([String(row.key), absoluteStart(row)]).toEqual([String(row.key), inkColumn]);
    }
  });

  it('puts the JSX renderer on the same left edge as the row builder', () => {
    // DashboardView wraps the banner in paddingX={1}; the row builder gives every
    // banner row paddingLeft: 1. Both then prepend BANNER_INDENT to each text
    // line, so the absolute start column is identical in the two renderers.
    const rows = dashboardRows() as any[];
    const inkColumn = logoInkStartColumn(rows);
    const jsxPadding = 1;
    expect(jsxPadding + logoInkStartPad()).toBe(inkColumn);
    expect(rowText(rows.find((r: any) => String(r.key).endsWith('-dash-tag')))).toBe(`${BANNER_INDENT}${DASHBOARD_TAGLINE}`);
  });

  it('keeps the example arrows on one shared column, measured from that edge', () => {
    const rows = dashboardRows() as any[];
    const arrowColumns = rows
      .filter((row: any) => /-dash-example-\d+$/.test(String(row.key)))
      .map((row: any) => {
        const full = `${' '.repeat(row.paddingLeft ?? 0)}${rowText(row)}`;
        return full.indexOf('→');
      });
    expect(arrowColumns.length).toBe(DASHBOARD_EXAMPLES.length);
    expect(new Set(arrowColumns).size).toBe(1);
    expect(arrowColumns[0]).toBe(1 + BANNER_INDENT.length + EXAMPLE_ARROW_COLUMN);
  });
});
