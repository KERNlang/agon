import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { cleanText, runSanitize, scanText } from './implementation.js';

const services = { permissions: { check: vi.fn(async () => 'allow') }, receipts: { record: vi.fn(async () => 'r') },
  state: { read: vi.fn(), write: vi.fn() }, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  engines: { dispatch: vi.fn() }, identity: {}, source: 'bundled' } as unknown as ModServices;
const context = { invocationId: 's', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };

describe('physical sanitize mod', () => {
  it('reports hidden channels on stderr so redirected stdout stays only the cleaned text', async () => {
    const result = await runSanitize({ text: 'hello\u200Bworld\n' }, context, services);
    expect(result.stdout).toBe('helloworld\n');
    expect(result.stderr).toContain('zero-width');
    expect(result.stderr).toContain('U+200B');
    const jsonl = await runSanitize({ text: 'hello\u200Bworld\n', jsonl: true }, context, services);
    expect(jsonl.stderr).toBeUndefined();
  });
  it('does not claim preserved findings were addressed when writing output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-sanitize-report-'));
    const out = join(root, 'out.txt');
    const text = 'payp\u0430l 1\uFE00';
    const result = await runSanitize({ text, out }, context, services);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(text);
    expect(result.stdout).toContain('0 finding(s) addressed; 2 reported-only finding(s) preserved');
    const mixed = await runSanitize({ text: `a\u200Bb ${text}`, out }, context, services);
    expect(mixed.stdout).toContain('1 finding(s) addressed; 2 reported-only finding(s) preserved');
    const actionable = await runSanitize({ text: 'a\u200Bb', out }, context, services);
    expect(actionable.stdout).toBe(`Cleaned output written to ${out} (1 finding(s) addressed; verified by re-scan).\n`);
  });
  it('preserves reported-only Unicode while removing legacy hidden characters', async () => {
    const reported = 'payp\u0430l 1\uFE00';
    const detected = await runSanitize({ text: reported, detect: true }, context, services);
    expect(detected.exitCode).toBe(0);
    expect(detected.result).toMatchObject({ clean: true, byChannel: { homoglyph: 1, 'variation-selector': 1 } });
    const cleaned = await runSanitize({ text: `a\u180Eb\u2000c ${reported}` }, context, services);
    expect(cleaned.exitCode).toBe(0);
    expect(cleaned.result).toMatchObject({ output: `abc ${reported}`, verifiedClean: true });
    expect(services.engines.dispatch).not.toHaveBeenCalled();
  });
  it('detects, cleans, and re-scans hidden channels idempotently', async () => {
    const dirty = 'a\u200bb  \nＦ'; expect(scanText(dirty).clean).toBe(false);
    const once = cleanText(dirty).output; expect(scanText(once).clean).toBe(true); expect(cleanText(once).output).toBe(once);
    const out = await runSanitize({ text: dirty }, context, services); expect(out.exitCode).toBe(0); expect((out.result as any).verifiedClean).toBe(true);
  });
  it('distinguishes detect findings and unknown metadata', async () => {
    expect((await runSanitize({ text: 'x\u202ey', detect: true }, context, services)).exitCode).toBe(1);
    expect((await runSanitize({ metadata: true, file: new URL(import.meta.url).pathname }, context, services)).exitCode).toBe(2);
  });
  it('strips metadata to an explicit destination and verifies the output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-sanitize-')); const source = join(root, 'dirty.svg'); const out = join(root, 'clean.svg');
    writeFileSync(source, '<svg><metadata><rdf>creator</rdf></metadata><rect width="1"/></svg>');
    const result = await runSanitize({ metadata: true, stripMetadata: true, file: source, out }, context, services);
    expect(result.exitCode).toBe(0); expect((result.result as any).removedFindings).toBe(1);
    expect(readFileSync(out, 'utf8')).toBe('<svg><rect width="1"/></svg>');
    expect(services.permissions.check).toHaveBeenCalledWith('fs.write', out);
    expect((await runSanitize({ metadata: true, stripMetadata: true, file: source }, context, services)).exitCode).toBe(1);
  });
  it('emits discriminated one-record-per-line JSONL for report and cleaned output', async () => {
    const result = await runSanitize({ text: 'a\u200bb', jsonl: true }, context, services);
    const records = result.stdout!.trim().split('\n').map((line) => JSON.parse(line));
    expect(records.map((record) => record.type)).toEqual(['sanitize.report', 'sanitize.cleaned']);
    expect(records[1]).toMatchObject({ output: 'ab', findings: 1 });
  });
});
