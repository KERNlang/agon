import { describe, expect, it } from 'vitest';

import * as engineModule from '../../packages/cli/src/blocks/engine.js';
import { VERSION } from '../../packages/cli/src/blocks/engine.js';
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
