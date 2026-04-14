import { describe, it, expect } from 'vitest';
import { detectIntent } from '../../packages/cli/src/intent.js';
import { buildForgePrompt } from '../../packages/core/src/prompt-builder.js';

describe('Build Handler', () => {
  describe('Intent Detection — /build', () => {
    it('/build parses task', () => {
      const r = detectIntent('/build fix auth.ts');
      expect(r.type).toBe('build');
      if (r.type === 'build') {
        expect(r.input).toBe('fix auth.ts');
      }
    });

    it('/build with no task', () => {
      const r = detectIntent('/build');
      expect(r.type).toBe('build');
      if (r.type === 'build') expect(r.input).toBe('');
    });

    it('/agent parses into its own agent intent (split from /build in Phase 5a)', () => {
      const r = detectIntent('/agent fix the login');
      expect(r.type).toBe('agent');
      if (r.type === 'agent') expect(r.input).toBe('fix the login');
    });
  });

  describe('Intent Detection — /run', () => {
    it('/run parses command', () => {
      const r = detectIntent('/run npm test');
      expect(r.type).toBe('run');
      if (r.type === 'run') expect(r.input).toBe('npm test');
    });

    it('/exec is an alias for /run', () => {
      const r = detectIntent('/exec ls -la');
      expect(r.type).toBe('run');
      if (r.type === 'run') expect(r.input).toBe('ls -la');
    });

    it('/shell is an alias for /run', () => {
      const r = detectIntent('/shell echo hello');
      expect(r.type).toBe('run');
      if (r.type === 'run') expect(r.input).toBe('echo hello');
    });

    it('/run with no command', () => {
      const r = detectIntent('/run');
      expect(r.type).toBe('run');
      if (r.type === 'run') expect(r.input).toBe('');
    });
  });

  describe('buildForgePrompt — agentMode', () => {
    it('includes agent-specific constraints when agentMode=true', () => {
      const prompt = buildForgePrompt({
        task: 'fix the bug',
        fitnessCmd: 'npm test',
        agentMode: true,
      });
      expect(prompt).toContain('full tool access');
      expect(prompt).toContain('Read files, edit code, run commands');
      expect(prompt).toContain('Iterate until');
    });

    it('uses standard constraints when agentMode=false', () => {
      const prompt = buildForgePrompt({
        task: 'fix the bug',
        fitnessCmd: 'npm test',
        agentMode: false,
      });
      expect(prompt).toContain('Write code, not plans');
      expect(prompt).not.toContain('full tool access');
    });

    it('uses standard constraints when agentMode is omitted', () => {
      const prompt = buildForgePrompt({
        task: 'fix the bug',
        fitnessCmd: 'npm test',
      });
      expect(prompt).toContain('Write code, not plans');
    });
  });

  describe('SLASH_COMMANDS includes /build and /run', () => {
    it('/build is in the command list', async () => {
      const { SLASH_COMMANDS } = await import('../../packages/cli/src/intent.js');
      const cmds = SLASH_COMMANDS.map((c: any) => c.cmd);
      expect(cmds).toContain('/build');
    });

    it('/run is in the command list', async () => {
      const { SLASH_COMMANDS } = await import('../../packages/cli/src/intent.js');
      const cmds = SLASH_COMMANDS.map((c: any) => c.cmd);
      expect(cmds).toContain('/run');
    });
  });
});
