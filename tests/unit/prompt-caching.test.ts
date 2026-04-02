import { describe, it, expect } from 'vitest';
import { splitPromptBlocks, mergeBlocksByRole } from '../../packages/core/src/generated/prompt-builder.js';

describe('Prompt Caching', () => {
  describe('splitPromptBlocks', () => {
    it('splits by ## headers', () => {
      const prompt = '## TASK\nDo something\n\n## CONSTRAINTS\n- Be fast\n\n## FITNESS TEST\nnpm test';
      const blocks = splitPromptBlocks(prompt);
      expect(blocks).toHaveLength(3);
    });

    it('marks CONSTRAINTS as cacheable system block', () => {
      const prompt = '## TASK\nDo it\n\n## CONSTRAINTS\n- Rule 1';
      const blocks = splitPromptBlocks(prompt);
      const constraints = blocks.find(b => b.content.includes('CONSTRAINTS'));
      expect(constraints?.role).toBe('system');
      expect(constraints?.cacheable).toBe(true);
    });

    it('marks TASK as dynamic user block', () => {
      const prompt = '## TASK\nBuild a widget\n\n## CONSTRAINTS\n- Fast';
      const blocks = splitPromptBlocks(prompt);
      const task = blocks.find(b => b.content.includes('TASK'));
      expect(task?.role).toBe('user');
      expect(task?.cacheable).toBe(false);
    });

    it('returns single block for no-header prompt', () => {
      const blocks = splitPromptBlocks('just a plain prompt');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].role).toBe('user');
    });

    it('marks FITNESS TEST as cacheable', () => {
      const prompt = '## TASK\nx\n\n## FITNESS TEST\nnpm test';
      const blocks = splitPromptBlocks(prompt);
      const fitness = blocks.find(b => b.content.includes('FITNESS TEST'));
      expect(fitness?.cacheable).toBe(true);
    });

    it('marks INSTRUCTIONS as cacheable', () => {
      const prompt = '## QUESTION\nx\n\n## INSTRUCTIONS\nDo this';
      const blocks = splitPromptBlocks(prompt);
      const instructions = blocks.find(b => b.content.includes('INSTRUCTIONS'));
      expect(instructions?.cacheable).toBe(true);
    });
  });

  describe('mergeBlocksByRole', () => {
    it('separates system and user blocks', () => {
      const blocks = splitPromptBlocks('## TASK\nDo it\n\n## CONSTRAINTS\n- Rule');
      const { system, user } = mergeBlocksByRole(blocks);
      expect(system).toContain('CONSTRAINTS');
      expect(user).toContain('TASK');
    });

    it('returns empty string for missing role', () => {
      const blocks = splitPromptBlocks('just text');
      const { system } = mergeBlocksByRole(blocks);
      expect(system).toBe('');
    });
  });
});
