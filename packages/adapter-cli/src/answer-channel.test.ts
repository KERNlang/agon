import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFileChannelForMode, answerChannelMode } from './generated/adapter-helpers.js';

describe('answer-channel mode gating', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.AGON_CLAUDE_ANSWER_CHANNEL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AGON_CLAUDE_ANSWER_CHANNEL;
    else process.env.AGON_CLAUDE_ANSWER_CHANNEL = saved;
  });

  describe('useFileChannelForMode — file mode (default/on)', () => {
    beforeEach(() => {
      delete process.env.AGON_CLAUDE_ANSWER_CHANNEL; // unset → 'file'
    });

    it('defaults (undefined mode) to exec and enables the channel', () => {
      expect(answerChannelMode()).toBe('file');
      expect(useFileChannelForMode(undefined)).toBe(true);
    });

    it('enables the channel for exec dispatch', () => {
      expect(useFileChannelForMode('exec')).toBe(true);
    });

    it('enables the channel for agent dispatch (the fix)', () => {
      expect(useFileChannelForMode('agent')).toBe(true);
    });
  });

  describe('useFileChannelForMode — channel off', () => {
    it('disables for every mode when AGON_CLAUDE_ANSWER_CHANNEL=off', () => {
      process.env.AGON_CLAUDE_ANSWER_CHANNEL = 'off';
      expect(answerChannelMode()).toBe('off');
      expect(useFileChannelForMode('exec')).toBe(false);
      expect(useFileChannelForMode('agent')).toBe(false);
      expect(useFileChannelForMode(undefined)).toBe(false);
    });

    it('disables for every mode when channel is mcp (file-only gate)', () => {
      process.env.AGON_CLAUDE_ANSWER_CHANNEL = 'mcp';
      expect(answerChannelMode()).toBe('mcp');
      expect(useFileChannelForMode('exec')).toBe(false);
      expect(useFileChannelForMode('agent')).toBe(false);
    });
  });
});
