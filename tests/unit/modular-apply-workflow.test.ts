import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { runApply } from '../../packages/mod-forge/src/apply.js';

const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n';
let root: string;
let cwd: string;
let artifact: string;
let abort: AbortController;
let active: boolean;
let events: string[];
let artifacts: { type: string; path: string }[][];
let confirm: ReturnType<typeof vi.fn<(workspace: string) => Promise<string>>>;
let legacy: ReturnType<typeof vi.fn>;
let failSuccessDisplay: boolean;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agon-physical-apply-'));
  cwd = join(root, 'workspace');
  execFileSync('git', ['init', '--quiet', cwd]);
  writeFileSync(join(cwd, 'file.txt'), 'before\n');
  execFileSync('git', ['add', 'file.txt'], { cwd });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit', '--quiet', '-m', 'fixture'], { cwd });
  artifact = join(root, 'change.patch');
  writeFileSync(artifact, patch);
  abort = new AbortController();
  active = true;
  events = [];
  artifacts = [];
  confirm = vi.fn(async () => 'yes');
  legacy = vi.fn(async () => ({ exitCode: 99, stderr: 'legacy workflow still owns Apply' }));
  failSuccessDisplay = false;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function invoke(patchPath: string | undefined = artifact, force = false) {
  const context = { invocationId: 'fixture', cwd, platform: 'darwin-arm64' as const,
    signal: abort.signal, config: {} };
  const interaction = {
    artifacts,
    notify: (level: string, message: string) => {
      if (failSuccessDisplay && level === 'success') throw new Error('generation changed during Git write');
      events.push(`${level}:${message}`);
    },
    preview: (preview: { engineId: string; content: string }) => { events.push(`preview:${preview.engineId}:${preview.content}`); },
    confirm,
    assertActive: () => { if (!active) throw new Error('approval session expired'); },
  };
  return runApply({ ...(patchPath ? { patchPath } : {}), force }, context,
    { patchApplication: { open: async () => interaction, apply: legacy } } as unknown as ModServices);
}

describe('Forge owns the complete Apply workflow', () => {
  it('applies repository-relative patches from a subdirectory and names the real target', async () => {
    const repo = cwd;
    cwd = join(repo, 'nested');
    mkdirSync(cwd);
    expect(await invoke()).toEqual({ exitCode: 0, result: { applied: true } });
    expect(readFileSync(join(repo, 'file.txt'), 'utf8')).toBe('after\n');
    expect(confirm).toHaveBeenCalledWith(realpathSync(repo));
  });
  it.each(['plain prose, not a patch', 'diff --git a/file.txt b/file.txt\n@@ broken @@\n+oops\n'])('does not bypass Git validation with force: %s', async content => {
    writeFileSync(artifact, content);
    writeFileSync(join(cwd, 'dirty.txt'), 'operator work');
    expect((await invoke(artifact, true)).exitCode).toBe(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  });
  it('rejects an empty manifest patch before approval', async () => {
    writeFileSync(artifact, '');
    writeFileSync(join(root, 'winner.json'), JSON.stringify({ winner: 'fixture', patches: { fixture: artifact } }));
    artifacts = [[{ type: 'manifest', path: '../winner.json' }]];
    expect((await invoke('')).exitCode).toBe(1);
    expect(confirm).not.toHaveBeenCalled();
  });
  it.each([false, true])('rechecks competing approvals, with explicit force=%s', async force => {
    writeFileSync(join(cwd, 'second.txt'), 'before\n');
    execFileSync('git', ['add', 'second.txt'], { cwd });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
      'commit', '--quiet', '-m', 'second fixture'], { cwd });
    const secondArtifact = join(root, 'second.patch');
    writeFileSync(secondArtifact, patch.replaceAll('file.txt', 'second.txt'));
    const answers: ((answer: string) => void)[] = [];
    confirm.mockImplementation(() => new Promise(resolve => answers.push(resolve)));
    const first = invoke(artifact, force);
    const second = invoke(secondArtifact, force);
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[0]('yes');
    expect(await first).toEqual({ exitCode: 0, result: { applied: true } });
    answers[1]('yes');
    expect(await second).toEqual({ exitCode: force ? 0 : 1, result: { applied: force } });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('after\n');
    expect(readFileSync(join(cwd, 'second.txt'), 'utf8')).toBe(force ? 'after\n' : 'before\n');
  });
  it('does not retain an executable CLI Apply owner', () => {
    const handler = readFileSync(new URL('../../packages/cli/src/handlers/plan.ts', import.meta.url), 'utf8');
    const host = readFileSync(new URL('../../packages/cli/src/patch-application-host.ts', import.meta.url), 'utf8');
    expect(handler).not.toMatch(/\b(handleApplyPatch|preflightApply|applyPatchToTree)\b/);
    expect(host).not.toMatch(/\b(preflightApply|applyPatchToTree)\b/);
    expect(host).not.toContain('session.apply(');
  });
  it('previews and confirms before real Git apply, without delegating execution to the host', async () => {
    confirm.mockImplementation(async workspace => {
      expect(workspace).toBe(realpathSync(cwd));
      expect(events.join('\n')).toContain('preview:unknown:diff --git');
      expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
      return 'yes';
    });
    expect(await invoke()).toEqual({ exitCode: 0, result: { applied: true } });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('after\n');
    expect(legacy).not.toHaveBeenCalled();
  });

  it('selects the first patch artifact across ordered plan steps', async () => {
    artifacts = [[{ type: 'manifest', path: '../missing.json' }],
      [{ type: 'patch', path: '../change.patch' }], [{ type: 'patch', path: '../wrong.patch' }]];
    expect(await invoke('')).toEqual({ exitCode: 0, result: { applied: true } });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('after\n');
  });

  it('uses the last step manifest only when there is no patch artifact', async () => {
    writeFileSync(join(root, 'winner.json'), JSON.stringify({ winner: 'fixture', patches: { fixture: artifact } }));
    artifacts = [[{ type: 'manifest', path: '../missing.json' }], [{ type: 'manifest', path: '../winner.json' }]];
    expect(await invoke('')).toEqual({ exitCode: 0, result: { applied: true } });
    expect(events.join('\n')).toContain('preview:fixture:');
  });

  it.each([false, true])('dirty force=%s does not grant approval', async force => {
    writeFileSync(join(cwd, 'untracked.txt'), 'operator work');
    confirm.mockResolvedValue('no');
    expect((await invoke(artifact, force)).exitCode).toBe(force ? 0 : 1);
    expect(confirm).toHaveBeenCalledTimes(force ? 1 : 0);
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
    expect(readFileSync(join(cwd, 'untracked.txt'), 'utf8')).toBe('operator work');
  });

  it.each(['y', 'YES'])('keeps the explicit affirmative answer %j', async answer => {
    confirm.mockResolvedValue(answer);
    expect(await invoke()).toEqual({ exitCode: 0, result: { applied: true } });
  });

  it('does not treat automatic question dismissal as approval', async () => {
    // output.ts resolves questions with an empty answer while a permission
    // request has priority. Empty therefore cannot prove user approval.
    confirm.mockResolvedValue('');
    expect(await invoke()).toEqual({ exitCode: 0, result: { applied: false } });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  });

  it('reports the actual applied result if post-write display fails', async () => {
    failSuccessDisplay = true;
    expect(await invoke()).toMatchObject({ exitCode: 0, result: { applied: true }, stderr: expect.stringContaining('Patch applied') });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('after\n');
  });

  it.each([false, true])('rechecks dirty state after approval with force=%s', async force => {
    confirm.mockImplementation(async () => { writeFileSync(join(cwd, 'operator.txt'), 'new work'); return 'yes'; });
    expect((await invoke(artifact, force)).exitCode).toBe(force ? 0 : 1);
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe(force ? 'after\n' : 'before\n');
    expect(readFileSync(join(cwd, 'operator.txt'), 'utf8')).toBe('new work');
    if (!force) expect(events.join('\n')).toContain('uncommitted changes');
  });

  it.each([false, true])('refuses an unknown Git state even with force=%s', async force => {
    cwd = root; // An owned temporary directory outside the initialized repo.
    writeFileSync(join(cwd, 'file.txt'), 'before\n');
    expect((await invoke(artifact, force)).exitCode).toBe(1);
    expect(events.join('\n')).toContain('Cannot check working tree');
    expect(confirm).not.toHaveBeenCalled();
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  });

  it('shows the complete patch before asking for approval', async () => {
    const lines = Array.from({ length: 120 }, (_, index) => `+line ${index}`).join('\n');
    writeFileSync(artifact, patch.replace('@@ -1 +1 @@', '@@ -1 +1,120 @@').replace('+after', lines));
    confirm.mockImplementation(async () => {
      expect(events.join('\n')).toContain('+line 119');
      return 'no';
    });
    expect(await invoke()).toEqual({ exitCode: 0, result: { applied: false } });
  });

  it('applies the previewed bytes even when the patch file changes during approval', async () => {
    confirm.mockImplementation(async () => { writeFileSync(artifact, patch.replace('+after', '+unapproved')); return 'y'; });
    expect((await invoke()).exitCode).toBe(0);
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('after\n');
  });

  it('refuses a write when cancelled during approval', async () => {
    confirm.mockImplementation(async () => { abort.abort(); return 'yes'; });
    await expect(invoke()).rejects.toMatchObject({ name: 'AbortError' });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  });

  it('rechecks the invocation lease after approval before writing', async () => {
    confirm.mockImplementation(async () => { active = false; return 'yes'; });
    await expect(invoke()).rejects.toThrow('approval session expired');
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  });

  it('refuses a headless invocation without using the old execution callback', async () => {
    const context = { invocationId: 'none', cwd, platform: 'darwin-arm64' as const, signal: abort.signal, config: {} };
    const result = await runApply({ patchPath: artifact }, context,
      { patchApplication: { open: async () => undefined, apply: legacy } } as unknown as ModServices);
    expect(result.exitCode).toBe(2);
    expect(legacy).not.toHaveBeenCalled();
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  });
});
