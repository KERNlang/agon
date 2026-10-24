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
