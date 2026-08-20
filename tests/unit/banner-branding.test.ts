import { describe, expect, it } from 'vitest';

import * as engineModule from '../../packages/cli/src/blocks/engine.js';
import { DASHBOARD_TAGLINE, LOGO_LINES, TAGLINE_PAD, VERSION } from '../../packages/cli/src/blocks/engine.js';
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
    expect(rowText(row)).toBe(`     v${VERSION}  ·  Powered by KERNlang.dev`);
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

// The tagline sits directly under the AGON figlet, so its indent is not a free
// hand-counted literal — it must keep the tagline's overhang balanced on both
// sides of the logo's ink block. Both banner renderers (DashboardView's JSX and
// app-rendering's row builder) have drifted apart before; this pins them together.
const logoInk = () => {
  const inked = LOGO_LINES.filter((line: string) => line.trim().length > 0);
  const start = Math.min(...inked.map((line: string) => line.length - line.trimStart().length));
  const end = Math.max(...inked.map((line: string) => line.trimEnd().length - 1));
  return { start, end };
};

describe('REPL banner tagline centering', () => {
  it('balances the tagline overhang around the logo ink block', () => {
    const { start, end } = logoInk();
    const left = start - TAGLINE_PAD;
    const right = (TAGLINE_PAD + DASHBOARD_TAGLINE.length - 1) - end;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('renders the tagline row at the same columns as the logo rows', () => {
    const rows = dashboardRows() as any[];
    const logoRow = rows.find((r: any) => String(r.key).endsWith('-logo-1'));
    const tagRow = rows.find((r: any) => String(r.key).endsWith('-dash-tag'));
    expect(logoRow).toBeDefined();
    expect(tagRow).toBeDefined();

    const absolute = (row: any): { start: number; end: number } => {
      const text = row.kind === 'gradient' ? String(row.text ?? '') : rowText(row);
      const full = `${' '.repeat(row.paddingLeft ?? 0)}${text}`;
      return { start: full.length - full.trimStart().length, end: full.trimEnd().length - 1 };
    };

    const logo = absolute(logoRow);
    const tag = absolute(tagRow);
    expect(tag.start).toBe(2);
    expect(tag.end).toBe(41);
    expect(Math.abs((logo.start - tag.start) - (tag.end - logo.end))).toBeLessThanOrEqual(1);
    expect(rowText(tagRow)).toContain(DASHBOARD_TAGLINE);
  });
});
