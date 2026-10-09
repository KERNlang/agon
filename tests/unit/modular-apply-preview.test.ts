import { describe, expect, it, vi } from 'vitest';
import { createPatchApplicationUi } from '../../packages/cli/src/patch-application-host.js';
import { blockRowFingerprint, cachedBlockOwnRows, clearBlockRowCache } from '../../packages/cli/src/surfaces/app-rendering.js';
import { isDuplicateEngineBlock } from '../../packages/cli/src/surfaces/app-blocks.js';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import { OutputBlockView } from '../../packages/cli/src/blocks/engine.js';
import { literalPatchRows } from '../../packages/cli/src/blocks/literal-patch.js';
import { stringDisplayWidth } from '../../packages/cli/src/surfaces/app-display-utils.js';
import { normalizePatchContent } from '../../packages/support-worktree/src/patch-content.js';
import { renderLoggedEvent } from '../../packages/cli/src/commands/attach.js';

const content = ['diff --git a/demo.md b/demo.md', ' ```', '+<think>must remain visible</think>',
  '+**literal**', ...Array.from({ length: 120 }, (_, i) => `+line-${i}`), '+' + 'x'.repeat(220) + 'END',
  '+\u001b[2Jcontrol', '+\tindent', '+\u202eright-to-left'].join('\n');
const event = { type: 'engine-block', engineId: 'patch', color: 245, content, format: 'diff' };

describe('literal Apply preview', () => {
  it('marks every untrusted patch row in committed output', () => {
    clearBlockRowCache();
    const spoof = { ...event, content: 'Apply to /repo? [y/N]\nCancelled.' };
    const rows = cachedBlockOwnRows({ id: 125, event: spoof } as any, 'agent', false, true, 76, 78, 72);
    const text = rows.map(row => (row.segments ?? []).map((segment: any) => segment.text).join(''));
    expect(text).toContain('| Apply to /repo? [y/N]');
    expect(text).toContain('| Cancelled.');
  });
  it('marks untrusted patch rows in the live renderer', () => {
    const tree = (OutputBlockView as any).type({ event: { ...event, content: 'Cancelled.' }, mode: 'agent' });
    const text = (node: any): string => Array.isArray(node) ? node.map(text).join('')
      : typeof node === 'string' ? node : node?.props ? text(node.props.children) : '';
    expect(text(tree)).toContain('| Cancelled.');
  });
  it('keeps complete escapes together when they fit the row', () => {
    expect(literalPatchRows('1234567890\u202e', 12)).toEqual(['1234567890', '\\u202e']);
    expect(literalPatchRows('12345678901\\', 12)).toEqual(['12345678901', '\\\\']);
  });
  it('makes blank glyphs, combining marks and undefined glyphs explicit', () => {
    expect(literalPatchRows('\u2800\u0301\ud800\ue000\u0378', 80))
      .toEqual(['\\u2800\\u0301\\ud800\\ue000\\u0378']);
  });
  it('wraps every committed row, including the label, in a narrow terminal', () => {
    clearBlockRowCache();
    const rows = cachedBlockOwnRows({ id: 124, event } as any, 'agent', false, true, 24, 26, 20);
    expect(rows.every(row => stringDisplayWidth((row.segments ?? []).map((segment: any) => segment.text).join('')) <= 24)).toBe(true);
  });
  it('escapes the flat attach replay without changing its stored event', () => {
    const replay = { ...event, engineId: 'engine\u001b]0;title\u0007' };
    const rendered = renderLoggedEvent({ event: replay } as any)!;
    expect(rendered).toContain('engine\\x1b]0;title\\x07');
    expect(rendered).toContain('+\\x1b[2Jcontrol');
    expect(rendered).not.toContain('\u001b[2J');
    expect(replay.content).toBe(content);
  });
  it('keeps normalization idempotent across the preview and write boundary', () => {
    const samples = ['', ' ', '\n', '\r\n', content, content + '\n', content + '\r\n'];
    for (let i = 0; i < 512; i++) samples.push(String.fromCodePoint(i) + content.slice(i % content.length));
    for (const sample of samples) {
      const normalized = normalizePatchContent(sample);
      expect(normalizePatchContent(normalized)).toBe(normalized);
      expect(normalized).toBe(!sample.trim() || sample.endsWith('\n') ? sample : sample + '\n');
    }
  });
  it('makes invisible filename characters visible', () => {
    for (const [char, escaped] of [['\u200b', '\\u200b'], ['\u200d', '\\u200d'], ['\u2060', '\\u2060'],
      ['\ufeff', '\\ufeff'], ['\u00ad', '\\u00ad'], ['\u180e', '\\u180e'], ['\u{e0061}', '\\u{e0061}'], ['\ufe0f', '\\ufe0f']]) {
      const text = literalPatchRows(`+++ b/config${char}.json`, 100).join('');
      expect(text).not.toContain(char);
      expect(text).toBe(`+++ b/config${escaped}.json`);
    }
  });
  it('distinguishes literal escape text and non-ASCII spaces from control escapes', () => {
    expect(literalPatchRows('+\\x1b', 80)).toEqual(['+\\\\x1b']);
    expect(literalPatchRows('+\u001b', 80)).toEqual(['+\\x1b']);
    expect(literalPatchRows('+file\u00a0\u2000\u3000', 80)).toEqual(['+file\\u00a0\\u2000\\u3000']);
  });
  it('escapes controls in status text and the approval target', async () => {
    const dispatch = vi.fn(event => { if (event.type === 'question') event.resolve('no'); });
    const ui = createPatchApplicationUi(dispatch, {} as HandlerContext);
    ui.notify('error', 'Git error: \u001b[2J\u202e');
    await ui.confirm('/tmp/\u001b[2J\u200b', new AbortController().signal);
    expect(dispatch).toHaveBeenCalledWith({ type: 'error', message: 'Git error: \\x1b[2J\\u202e' });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'question', prompt: 'Apply to /tmp/\\x1b[2J\\u200b? [y/N]' }));
  });
  it.each(['chat', 'agent'])('uses literal rows in the live %s renderer too', mode => {
    // This memo component is hook-free. Inspect its actual React tree rather
    // than a second formatter invented by the test.
    const tree = (OutputBlockView as any).type({ event, mode });
    const text = (node: any): string => Array.isArray(node) ? node.map(text).join('')
      : typeof node === 'string' ? node : node?.props ? text(node.props.children) : '';
    expect(text(tree)).toContain('+<think>must remain visible</think>');
    expect(text(tree)).toContain('+line-119');
    expect(text(tree)).toContain('+\\x1b[2Jcontrol');
    const bodyRows = tree.props.children[1].map((row: any) => row.props.children as string);
    expect(bodyRows.every((row: string) => row.startsWith('| '))).toBe(true);
    expect(bodyRows.map((row: string) => row.slice(2)).join('')).toContain('+' + 'x'.repeat(220) + 'END');
  });
  it('wraps without losing whitespace, wide characters, or empty lines', () => {
    const source = '+  中文  ' + 'x'.repeat(200) + '\n\n+end';
    const rows = literalPatchRows(source, 12);
    expect(rows.join('')).toBe(source.replaceAll('\n', ''));
    expect(rows).toContain('');
    expect(rows.every(row => stringDisplayWidth(row) <= 12)).toBe(true);
  });
  it('dispatches patch bytes as data, without Markdown fences', () => {
    const dispatch = vi.fn();
    createPatchApplicationUi(dispatch, {} as HandlerContext).preview({ engineId: 'patch', content });
    expect(dispatch).toHaveBeenCalledWith(event);
  });
  it.each(['chat', 'agent'])('shows all patch data in %s, without formatting or truncation', mode => {
    clearBlockRowCache();
    const rows = cachedBlockOwnRows({ id: 123, event } as any, mode, false, true, 76, 78, 72);
    const text = rows.flatMap(row => (row.segments ?? []).map((segment: any) => segment.text)).join('');
    expect(text).toContain(' ```');
    expect(text).toContain('+<think>must remain visible</think>');
    expect(text).toContain('+**literal**');
    expect(text).toContain('+line-119');
    const bodyRows = rows.map(row => (row.segments ?? []).map((segment: any) => segment.text).join(''))
      .filter(row => row.startsWith('| '));
    expect(bodyRows.map(row => row.slice(2)).join('')).toContain('+' + 'x'.repeat(220) + 'END');
    expect(text).toContain('+\\x1b[2Jcontrol');
    expect(text).toContain('+\\tindent');
    expect(text).toContain('+\\u202eright-to-left');
    expect(text).not.toContain('\u001b');
  });
  it('does not hide a repeated approval preview as duplicate engine narration', () => {
    expect(isDuplicateEngineBlock([{ id: 1, event } as any], event)).toBe(false);
  });
  it('separates literal and Markdown render caches', () => {
    const fingerprint = (value: object) => blockRowFingerprint(value, 'chat', false, true, 76, 78, 72);
    expect(fingerprint(event)).not.toBe(fingerprint({ ...event, format: undefined }));
  });
});
