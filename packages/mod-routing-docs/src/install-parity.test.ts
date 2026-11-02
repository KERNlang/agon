import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { runGuide } from './implementation.js';
import { codexSkillOpenAiYaml } from './guide-content.js';

describe('prompt installation target parity', () => {
  let home: string;
  const context = {} as InvocationContext;
  const check = vi.fn(async () => 'allow');
  const record = vi.fn(async () => 'receipt');
  const services = { permissions: { check }, receipts: { record } } as unknown as ModServices;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agon-install-parity-'));
    vi.stubEnv('HOME', home);
    check.mockReset().mockResolvedValue('allow');
    record.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('defaults to all detected CLIs without creating files during preview', async () => {
    for (const directory of ['.codex', '.antigravitycli', '.claude']) mkdirSync(join(home, directory));
    const result = await runGuide({ dry: true }, context, services, true);
    expect(JSON.parse(result.stdout!)).toEqual([
      { path: join(home, '.codex/skills/agon/SKILL.md'), action: 'write' },
      { path: join(home, '.codex/skills/agon/agents/openai.yaml'), action: 'write' },
      { path: join(home, '.antigravitycli/commands/agon.toml'), action: 'write' },
      { path: join(home, '.claude/commands/agon.md'), action: 'write' },
    ]);
    expect(check).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(existsSync(join(home, '.codex/skills'))).toBe(false);
  });

  it('does not install an unselected CLI when no config directory exists', async () => {
    expect((await runGuide({}, context, services, true)).exitCode).toBe(1);
    expect(existsSync(join(home, '.codex'))).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('normalizes and deduplicates explicit targets, retaining unknown-target warnings', async () => {
    const result = await runGuide({ cli: ' CODEX, codex,typo, ', dry: true }, context, services, true);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout!).map((file: { path: string }) => file.path)).toEqual([
      join(home, '.codex/skills/agon/SKILL.md'),
      join(home, '.codex/skills/agon/agents/openai.yaml'),
    ]);
    expect(result.stderr).toContain('typo');
    expect((await runGuide({ cli: 'CoDeX', dry: true }, context, services, true)).exitCode).toBe(0);
  });

  it('detects only the existing Claude configuration', async () => {
    mkdirSync(join(home, '.claude'));
    expect((await runGuide({}, context, services, true)).exitCode).toBe(0);
    expect(existsSync(join(home, '.claude/commands/agon.md'))).toBe(true);
    expect(existsSync(join(home, '.codex'))).toBe(false);
    expect(existsSync(join(home, '.antigravitycli'))).toBe(false);
    expect(record).toHaveBeenCalledWith('agent-prompts-installed', expect.objectContaining({ targets: ['claude'] }));
  });

  it('does not fall back to detected targets for an unknown explicit target', async () => {
    mkdirSync(join(home, '.codex'));
    const result = await runGuide({ cli: 'typo' }, context, services, true);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('typo');
    expect(existsSync(join(home, '.codex/skills'))).toBe(false);
    expect(check).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('retains target warnings on a denied write without a success receipt', async () => {
    check.mockResolvedValue('deny');
    const result = await runGuide({ cli: 'codex,typo' }, context, services, true);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('typo');
    expect(result.stderr).toContain('Permission denied');
    expect(existsSync(join(home, '.codex'))).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });

  it('writes both Codex files with grants, preserves existing files, and honors force', async () => {
    const yaml = join(home, '.codex/skills/agon/agents/openai.yaml');
    expect((await runGuide({ cli: 'codex' }, context, services, true)).exitCode).toBe(0);
    expect(readFileSync(yaml, 'utf8')).toBe(codexSkillOpenAiYaml());
    expect(check).toHaveBeenCalledWith('fs.write', yaml);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('agent-prompts-installed', expect.objectContaining({ targets: ['codex'] }));
    writeFileSync(yaml, 'operator content');
    await runGuide({ cli: 'codex' }, context, services, true);
    expect(readFileSync(yaml, 'utf8')).toBe('operator content');
    await runGuide({ cli: 'codex', force: true }, context, services, true);
    expect(readFileSync(yaml, 'utf8')).toBe(codexSkillOpenAiYaml());
  });
});
