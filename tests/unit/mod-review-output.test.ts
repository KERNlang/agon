import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult, InvocationContext, Json, ModServices } from '@kernlang/agon-mod-api';
import { runReview } from '../../packages/mod-review/src/implementation.js';
import { annotateExistingCode, existingCodeMatch, existingCodeReader } from '../../packages/mod-review/src/existing-code.js';
import { formatSarif, lineRegion } from '../../packages/mod-review/src/report.js';
import { isSecretPath, redactSecrets, redactSecretsPreservingLines } from '../../packages/support-verification/src/secret-redaction.js';

const TOKEN = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function repo(changed = 'export const a = maybe!.value;\n', path = 'src/a.ts'): string {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-review-output-'));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  mkdirSync(join(cwd, dirname(path)), { recursive: true });
  writeFileSync(join(cwd, path), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  writeFileSync(join(cwd, path), changed);
  return cwd;
}

const block = (findings: unknown[]) => `Review prose.\n<!--AGON_REVIEW_FINDINGS_v1-->\n\`\`\`json\n${JSON.stringify(findings)}\n\`\`\``;
const finding = (extra: Record<string, unknown> = {}) => ({
  file: 'src/a.ts', lines: '1', severity: 'important', blocking: false, confidence: 0.75,
  problem: 'unsafe non-null assertion on maybe', minimalFix: 'guard it', ...extra,
});

function host(stdout: string, withRuns = true) {
  const dispatch = vi.fn(async (engineId: string) => ({
    engineId, exitCode: 0, stdout, cleanedText: stdout, stderr: '', timedOut: false, finishReason: 'stop',
  }));
  const writeArtifact = vi.fn(async () => undefined);
  const services = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record: vi.fn(async () => 'receipt') },
    ...(withRuns ? {
      runs: {
        start: vi.fn(async () => ({ id: 'run', path: '/runs/review', mode: 'review', startedAt: '2026-01-01T00:00:00Z' })),
        finish: vi.fn(async () => undefined), writeArtifact,
      },
    } : {}),
    engines: { listActive: vi.fn(async () => ['alpha']), dispatch },
  } as unknown as ModServices;
  return { services, dispatch, writeArtifact };
}

const context = (cwd: string): InvocationContext =>
  ({ invocationId: 'i', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });

async function review(cwd: string, input: Record<string, Json>, h: ReturnType<typeof host>) {
  return await runReview({ engine: 'alpha', ...input }, context(cwd), h.services) as CommandResult;
}

const artifact = (h: ReturnType<typeof host>, name: string) =>
  (h.writeArtifact.mock.calls as unknown as unknown[][]).find(call => call[1] === name)?.[2] as string | undefined;

describe('mod-review output formats', () => {
  it('keeps JSON on stdout by default', async () => {
    const out = await review(repo(), {}, host(block([finding()])));
    expect(JSON.parse(out.stdout!)).toMatchObject({ target: 'uncommitted changes', consensus: { findings: [{ file: 'src/a.ts' }] } });
  });

  it('emits SARIF 2.1.0 with one result per consensus finding', async () => {
    const out = await review(repo(), { format: 'sarif' }, host(block([finding({ lines: '1-3' })])));
    const sarif = JSON.parse(out.stdout!);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver.name).toBe('agon-review');
    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0]).toMatchObject({
      level: 'warning',
      locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.ts' }, region: { startLine: 1, endLine: 3 } } }],
    });
  });

  it('emits a readable text summary', async () => {
    const out = await review(repo(), { format: 'text' }, host(block([finding()])));
    expect(out.stdout).toContain('Seats: 1/1 ok');
    expect(out.stdout).toContain('src/a.ts:1');
  });

  it('rejects an unknown format before dispatch', async () => {
    const h = host(block([]));
    const out = await review(repo(), { format: 'xml' }, h);
    expect(out.exitCode).toBe(1);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('builds SARIF regions only from parseable line ranges and encodes paths', () => {
    expect(lineRegion('n/a')).toBeUndefined();
    expect(lineRegion('7')).toEqual({ startLine: 7, endLine: 7 });
    const sarif = JSON.parse(formatSarif({ target: 't', reviews: [], consensus: { findings: [{ file: 'my dir/a.ts', lines: 'n/a', severity: 'nit', problem: 'p', engines: ['x'] }] } as never }));
    expect(sarif.runs[0].results[0].locations[0].physicalLocation).toEqual({ artifactLocation: { uri: 'my%20dir/a.ts' } });
    expect(JSON.parse(formatSarif({ target: 't', reviews: [] })).runs[0].results).toEqual([]);
  });
});

describe('mod-review run persistence', () => {
  it('writes the diff and the report into the run dir', async () => {
    const h = host(block([finding()]));
    await review(repo(), {}, h);
    expect(artifact(h, 'diff.patch')).toContain('maybe!.value');
    expect(JSON.parse(artifact(h, 'report.json')!)).toMatchObject({ target: 'uncommitted changes' });
  });

  it('still reviews when the host has no run storage', async () => {
    const out = await review(repo(), {}, host(block([finding()]), false));
    expect(out.exitCode).toBe(0);
  });
});

describe('mod-review secret redaction', () => {
  it('never sends a secret from the diff to an engine', async () => {
    const h = host(block([]));
    await review(repo(`export const token = "${TOKEN}";\n`), {}, h);
    const prompt = h.dispatch.mock.calls[0][1] as unknown as string;
    expect(prompt).not.toContain(TOKEN);
    expect(prompt).toContain('[REDACTED-SECRET]');
  });

  it('redacts a secret echoed by a seat from stdout and every artifact', async () => {
    const h = host(block([finding({ minimalFix: `rotate ${TOKEN}` })]));
    const out = await review(repo(), {}, h);
    expect(out.stdout).not.toContain(TOKEN);
    for (const call of h.writeArtifact.mock.calls as unknown as unknown[][]) expect(String(call[2])).not.toContain(TOKEN);
  });

  it('keeps line count when redacting a multi-line private key', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nabc\ndef\n-----END RSA PRIVATE KEY-----';
    expect(redactSecretsPreservingLines(`a\n${key}\nb`).split('\n')).toHaveLength(6);
    expect(redactSecrets(`a\n${key}\nb`)).toBe('a\n[REDACTED-SECRET]\nb');
  });
});

describe('mod-review existingCode', () => {
  it('marks a quote that matches the current file ignoring whitespace', async () => {
    const out = await review(repo(), {}, host(block([finding({ existingCode: 'export const a =   maybe!.value;' })])));
    expect(JSON.parse(out.stdout!).consensus.findings[0]).toMatchObject({ existingCodeMatch: true });
  });

  it('marks a quote that is not in the file', async () => {
    const out = await review(repo(), {}, host(block([finding({ existingCode: 'export const b = 2;' })])));
    expect(JSON.parse(out.stdout!).consensus.findings[0]).toMatchObject({ existingCodeMatch: false });
  });

  it('matches a quote of a redacted secret line against the redacted file', () => {
    const cwd = repo(`export const token = "${TOKEN}";\n`);
    expect(existingCodeMatch('src/a.ts', 'export const token = "[REDACTED-SECRET]";', cwd)).toBe(true);
  });

  it('never reads outside the repo or a secret file', () => {
    const cwd = repo();
    writeFileSync(join(cwd, '.env'), 'X=1\n');
    const elsewhere = mkdtempSync(join(tmpdir(), 'agon-review-elsewhere-'));
    roots.push(elsewhere);
    writeFileSync(join(elsewhere, 'x'), 'y\n');
    symlinkSync(elsewhere, join(cwd, 'outside'));
    expect(existingCodeMatch('../etc/passwd', 'root', cwd)).toBeUndefined();
    expect(existingCodeMatch('/etc/passwd', 'root', cwd)).toBeUndefined();
    expect(existingCodeMatch('.env', 'X=1', cwd)).toBeUndefined();
    expect(existingCodeMatch('outside/x', 'y', cwd)).toBeUndefined();
    expect(existingCodeMatch('src/deleted.ts', 'y', cwd)).toBe(false);
  });
});

describe('mod-review phase B review fixes', () => {
  it('blocks relative and backslash secret paths', () => {
    for (const path of ['.aws/credentials', './.ssh/id_rsa', 'home\\me\\.docker\\config.json', 'a/.env']) expect(isSecretPath(path)).toBe(true);
    expect(isSecretPath('src/credentials.ts')).toBe(false);
  });

  it('keeps env references but still redacts literal env secrets', () => {
    const code = 'const GITHUB_TOKEN = process.env.GITHUB_TOKEN_VALUE;';
    expect(redactSecretsPreservingLines(code)).toBe(code);
    expect(redactSecretsPreservingLines('GITHUB_TOKEN=abcd1234efgh5678')).toBe('[REDACTED-SECRET]');
  });

  it('refuses a symlink that resolves to a secret file', () => {
    const cwd = repo();
    writeFileSync(join(cwd, '.env'), 'X=1\n');
    symlinkSync(join(cwd, '.env'), join(cwd, 'src/config.txt'));
    expect(existingCodeMatch('src/config.txt', 'X=1', cwd)).toBeUndefined();
  });

  it('keeps token boundaries when normalizing whitespace', () => {
    const cwd = repo('return username;\n');
    expect(existingCodeMatch('src/a.ts', 'return user name;', cwd)).toBe(false);
    expect(existingCodeMatch('src/a.ts', '  return   username;', cwd)).toBe(true);
  });

  it('matches quotes against the diff post-image for non-working-tree targets', () => {
    const diff = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n keep();\n-old();\n+fresh();\n';
    const [hit, miss, removed] = annotateExistingCode([
      finding({ existingCode: 'fresh();' }),
      finding({ existingCode: 'absent();' }),
      finding({ existingCode: 'old();' }),
    ] as never, existingCodeReader({ diff }));
    expect([hit.existingCodeMatch, miss.existingCodeMatch, removed.existingCodeMatch]).toEqual([true, false, false]);
  });

  it('redacts mutation evidence before it reaches a prompt or an artifact', async () => {
    const h = host(block([]));
    await runReview({ engine: 'alpha' }, context(repo()), h.services, { mutationEvidence: `survivor leaked ${TOKEN}` });
    expect(h.dispatch.mock.calls[0][1] as unknown as string).not.toContain(TOKEN);
    expect(artifact(h, 'mutation-evidence.txt')).not.toContain(TOKEN);
  });

  it('tells seats that redaction markers are not bugs', async () => {
    const h = host(block([]));
    await review(repo(`export const token = "${TOKEN}";\n`), {}, h);
    expect(h.dispatch.mock.calls[0][1] as unknown as string).toMatch(/^NOTE: Agon replaced credential-looking values/);
  });

  it('emits empty SARIF when there is no diff', async () => {
    const cwd = repo();
    execFileSync('git', ['checkout', '--', '.'], { cwd });
    const out = await review(cwd, { format: 'sarif' }, host(block([])));
    expect(JSON.parse(out.stdout!).runs[0].results).toEqual([]);
  });

  it('marks a degraded panel in SARIF run properties', () => {
    const sarif = JSON.parse(formatSarif({ target: 't', reviews: [{ engineId: 'a', status: 'timeout' }], panelHealth: { requested: 2, responded: 1, degraded: true } }));
    expect(sarif.runs[0].properties).toMatchObject({ degraded: true, seats: [{ engine: 'a', status: 'timeout' }] });
  });
});
