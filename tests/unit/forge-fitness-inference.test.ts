import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractFitnessCommandFromCesarOutput, inferProjectFitnessCommand, normalizeGithubRemoteLiteral, repairContradictoryFitnessLiterals, repairFitnessCommandRepositoryLiteral, repairFitnessCommandTaskLiterals, repairForgeTaskRepositoryLiteral, repairOverbroadForbiddenLiterals, taskWantsRepositoryLinkCheck, validateFitnessCommandIntent } from '../../packages/cli/src/generated/handlers/forge.js';

describe('forge fitness preparation', () => {
  it('parses Cesar JSON fitness output', () => {
    const fitness = extractFitnessCommandFromCesarOutput(
      '{"fitnessCmd":"npm run test:ts -- tests/unit/forge-fitness-inference.test.ts","reason":"focused regression"}',
    );

    expect(fitness).toBe('npm run test:ts -- tests/unit/forge-fitness-inference.test.ts');
  });

  it('parses a plain one-line Cesar command', () => {
    expect(extractFitnessCommandFromCesarOutput('npm run typecheck')).toBe('npm run typecheck');
  });

  it('repairs hallucinated GitHub repo literals against the user task', () => {
    const task = 'Require github.com/cukas/Agon-AI in the README.';
    const cmd = "node -e \"if(!s.includes('github.com/cukus/Agon-AI')) process.exit(1)\"";

    expect(repairFitnessCommandTaskLiterals(task, cmd)).toContain('github.com/cukas/Agon-AI');
    expect(repairFitnessCommandTaskLiterals(task, cmd)).not.toContain('github.com/cukus/Agon-AI');
  });

  it('normalizes repository links from git origin for current-repo fitness checks', () => {
    const repo = normalizeGithubRemoteLiteral('git@github.com:KERNlang/agon.git');
    const cmd = "node -e \"if(!s.includes('github.com/cukas/Agon-AI')) process.exit(1)\"";

    expect(repo).toBe('github.com/KERNlang/agon');
    expect(repairFitnessCommandRepositoryLiteral(cmd, repo)).toContain('github.com/KERNlang/agon');
    expect(repairFitnessCommandRepositoryLiteral(cmd, repo)).not.toContain('github.com/cukas/Agon-AI');
  });

  it('removes forbidden literals that contradict required literals', () => {
    const cmd = "node -e \"const required=['Quick Start','github.com/KERNlang/agon'];const forbidden=['build:cli','KERNlang','packages/'];for(const r of required){}for(const f of forbidden){}\"";
    const repaired = repairContradictoryFitnessLiterals(cmd);

    expect(repaired).toContain("required=['Quick Start','github.com/KERNlang/agon']");
    expect(repaired).toContain("forbidden=['build:cli','packages/']");
    expect(repaired).not.toContain("'KERNlang','packages/'");
  });

  it('does not infer GitHub URL checks for local-only README tasks', () => {
    const task = 'Make the README beta-ready for this repo. Keep it concise and local.';
    const cmd = "node -e \"const c=require('fs').readFileSync('README.md','utf8');if(!c.includes('github.com/KERNlang/agon'))process.exit(1)\"";

    expect(taskWantsRepositoryLinkCheck(task)).toBe(false);
    expect(validateFitnessCommandIntent(task, cmd, 'github.com/KERNlang/agon')).toEqual({
      ok: false,
      reason: 'fitness added repository URL check without repo-link intent: github.com/KERNlang/agon',
    });
  });

  it('allows repo URL checks when the task semantically asks for a footer link', () => {
    const task = 'Make the README beta-ready and end with a footer link to the public repository.';
    const cmd = "node -e \"const c=require('fs').readFileSync('README.md','utf8');if(!c.includes('github.com/KERNlang/agon'))process.exit(1)\"";

    expect(taskWantsRepositoryLinkCheck(task)).toBe(true);
    expect(validateFitnessCommandIntent(task, cmd, 'github.com/KERNlang/agon')).toEqual({ ok: true });
  });

  it('repairs local identity names that Cesar over-generalized as forbidden internals', () => {
    const task = 'Make the README beta-ready and avoid KERN compilation steps.';
    const cmd = "node -e \"const forbidden=['KERNlang','kern:compile','packages/'];for(const f of forbidden){}\"";
    const repaired = repairOverbroadForbiddenLiterals(task, cmd, 'github.com/KERNlang/agon');

    expect(repaired).toContain("forbidden=['kern:compile','packages/']");
    expect(repaired).not.toContain("'KERNlang'");
  });

  it('normalizes current-repo links in forge tasks before dispatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-forge-task-repo-'));
    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:KERNlang/agon.git'], { cwd: dir, stdio: 'ignore' });
      const repaired = repairForgeTaskRepositoryLiteral('README must contain github.com/cukas/Agon-AI', dir);

      expect(repaired).toContain('github.com/KERNlang/agon');
      expect(repaired).not.toContain('github.com/cukas/Agon-AI');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auto-selects a project fitness command instead of asking the user', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-forge-fitness-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc -b' } }));
      expect(inferProjectFitnessCommand(dir)).toBe('npm run typecheck');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to a generic git diff check when no project test is detectable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-forge-fitness-empty-'));
    try {
      expect(inferProjectFitnessCommand(dir)).toBe('git diff --check');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
