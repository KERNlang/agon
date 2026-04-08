import { describe, it, expect, afterEach } from 'vitest';
import { loadSkillFile, findSkill, renderSkillPrompt, parseFrontmatter } from '../../packages/core/src/generated/blocks/skill-loader.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SkillLoader', () => {
  const testDir = join(tmpdir(), `skill-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  describe('parseFrontmatter', () => {
    it('parses YAML frontmatter', () => {
      const content = '---\nname: test\ntrigger: /test\n---\nBody here';
      const { meta, body } = parseFrontmatter(content);
      expect(meta.name).toBe('test');
      expect(meta.trigger).toBe('/test');
      expect(body).toBe('Body here');
    });

    it('returns raw content when no frontmatter', () => {
      const content = 'Just plain text';
      const { meta, body } = parseFrontmatter(content);
      expect(Object.keys(meta)).toHaveLength(0);
      expect(body).toBe(content);
    });
  });

  describe('loadSkillFile', () => {
    it('loads a valid skill file', () => {
      mkdirSync(testDir, { recursive: true });
      const filePath = join(testDir, 'test.md');
      writeFileSync(filePath, '---\nname: Test Skill\ntrigger: /test\ndescription: A test\n---\nDo {input}');

      const skill = loadSkillFile(filePath);
      expect(skill).not.toBeNull();
      expect(skill!.name).toBe('Test Skill');
      expect(skill!.trigger).toBe('/test');
      expect(skill!.description).toBe('A test');
      expect(skill!.prompt).toBe('Do {input}');
    });

    it('returns null for file without name', () => {
      mkdirSync(testDir, { recursive: true });
      const filePath = join(testDir, 'bad.md');
      writeFileSync(filePath, '---\ntrigger: /bad\n---\nBody');

      const skill = loadSkillFile(filePath);
      expect(skill).toBeNull();
    });

    it('returns null for file without trigger', () => {
      mkdirSync(testDir, { recursive: true });
      const filePath = join(testDir, 'notrigger.md');
      writeFileSync(filePath, '---\nname: No Trigger\n---\nBody');

      const skill = loadSkillFile(filePath);
      expect(skill).toBeNull();
    });

    it('adds / prefix to trigger if missing', () => {
      mkdirSync(testDir, { recursive: true });
      const filePath = join(testDir, 'noslash.md');
      writeFileSync(filePath, '---\nname: No Slash\ntrigger: mycommand\n---\nBody');

      const skill = loadSkillFile(filePath);
      expect(skill!.trigger).toBe('/mycommand');
    });
  });

  describe('findSkill', () => {
    it('finds by trigger', () => {
      const skills = [
        { name: 'A', trigger: '/alpha', description: '', prompt: '', source: '' },
        { name: 'B', trigger: '/beta', description: '', prompt: '', source: '' },
      ];
      expect(findSkill('/alpha', skills)?.name).toBe('A');
      expect(findSkill('/beta', skills)?.name).toBe('B');
    });

    it('returns null for unknown trigger', () => {
      const skills = [{ name: 'A', trigger: '/alpha', description: '', prompt: '', source: '' }];
      expect(findSkill('/gamma', skills)).toBeNull();
    });

    it('normalizes trigger with /', () => {
      const skills = [{ name: 'A', trigger: '/alpha', description: '', prompt: '', source: '' }];
      expect(findSkill('alpha', skills)?.name).toBe('A');
    });
  });

  describe('renderSkillPrompt', () => {
    it('replaces {input} placeholder', () => {
      const skill = { name: 'Test', trigger: '/test', description: '', prompt: 'Review {input}', source: '' };
      expect(renderSkillPrompt(skill, 'my code')).toBe('Review my code');
    });

    it('replaces {name} placeholder', () => {
      const skill = { name: 'MySkill', trigger: '/ms', description: '', prompt: 'Running {name}', source: '' };
      expect(renderSkillPrompt(skill, '')).toBe('Running MySkill');
    });

    it('replaces multiple placeholders', () => {
      const skill = { name: 'S', trigger: '/s', description: '', prompt: '{name}: {input} via {trigger}', source: '' };
      expect(renderSkillPrompt(skill, 'task')).toBe('S: task via /s');
    });
  });
});
