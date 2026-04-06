import { describe, it, expect } from 'vitest';
import { parseSuggestion, parseConfidence, confidenceBadge, CONFIDENCE_TIERS } from '../../packages/cli/src/handlers/cesar-brain.js';

describe('Cesar Brain', () => {
  describe('parseSuggestion', () => {
    // Legacy [DELEGATE:] format still works
    it('detects [DELEGATE:build]', () => {
      const { action, rest } = parseSuggestion('[DELEGATE:build] This needs agent mode.');
      expect(action).toBe('build');
      expect(rest).toBe('This needs agent mode.');
    });

    it('detects [DELEGATE:forge]', () => {
      const { action, rest } = parseSuggestion('[DELEGATE:forge] Multiple engines should compete.');
      expect(action).toBe('forge');
      expect(rest).toBe('Multiple engines should compete.');
    });

    it('detects [DELEGATE:brainstorm]', () => {
      const { action } = parseSuggestion('[DELEGATE:brainstorm] Let\'s get multiple perspectives.');
      expect(action).toBe('brainstorm');
    });

    it('detects [DELEGATE:tribunal]', () => {
      const { action } = parseSuggestion('[DELEGATE:tribunal] This needs debate.');
      expect(action).toBe('tribunal');
    });

    // New [SUGGEST:] format
    it('detects [SUGGEST:forge-hardened]', () => {
      const result = parseSuggestion('[SUGGEST:forge-hardened] Complex auth refactor needs gauntlet.');
      expect(result.action).toBe('forge');
      expect(result.hardened).toBe(true);
      expect(result.rest).toBe('Complex auth refactor needs gauntlet.');
    });

    it('detects [SUGGEST:team-forge]', () => {
      const result = parseSuggestion('[SUGGEST:team-forge] Teams should compete on this.');
      expect(result.action).toBe('team-forge');
      expect(result.team).toBe(true);
    });

    it('detects [SUGGEST:team-forge-hardened]', () => {
      const result = parseSuggestion('[SUGGEST:team-forge-hardened] High-stakes change.');
      expect(result.action).toBe('team-forge');
      expect(result.hardened).toBe(true);
      expect(result.team).toBe(true);
    });

    it('detects [SUGGEST:tribunal-adversarial]', () => {
      const result = parseSuggestion('[SUGGEST:tribunal-adversarial] Heated debate needed.');
      expect(result.action).toBe('tribunal');
      expect(result.tribunalMode).toBe('adversarial');
    });

    it('detects [SUGGEST:team-tribunal-synthesis]', () => {
      const result = parseSuggestion('[SUGGEST:team-tribunal-synthesis] Combine proposals.');
      expect(result.action).toBe('team-tribunal');
      expect(result.tribunalMode).toBe('synthesis');
      expect(result.team).toBe(true);
    });

    it('detects [SUGGEST:campfire]', () => {
      const result = parseSuggestion('[SUGGEST:campfire] Open discussion.');
      expect(result.action).toBe('campfire');
    });

    it('detects [SUGGEST:pipeline]', () => {
      const result = parseSuggestion('[SUGGEST:pipeline] Full pipeline for this.');
      expect(result.action).toBe('pipeline');
    });

    it('returns null for non-suggestion response', () => {
      const { action, rest } = parseSuggestion('Here is my direct answer to your question.');
      expect(action).toBeNull();
      expect(rest).toBe('Here is my direct answer to your question.');
    });

    it('finds marker within first 150 chars even with leading text', () => {
      const { action, rest } = parseSuggestion('I think [SUGGEST:build] might help here.');
      expect(action).toBe('build');
      expect(rest).toBe('might help here.');
    });

    it('returns null for marker beyond 150 chars', () => {
      const padding = 'x'.repeat(150);
      const { action } = parseSuggestion(`${padding} [SUGGEST:build] too far`);
      expect(action).toBeNull();
    });

    it('handles empty response', () => {
      const { action, rest } = parseSuggestion('');
      expect(action).toBeNull();
      expect(rest).toBe('');
    });

    it('handles suggestion with no explanation', () => {
      const { action, rest } = parseSuggestion('[SUGGEST:build]');
      expect(action).toBe('build');
      expect(rest).toBe('');
    });

    it('is case-insensitive for marker', () => {
      const result = parseSuggestion('[suggest:forge-hardened] Test.');
      expect(result.action).toBe('forge');
      expect(result.hardened).toBe(true);
    });

    // ── Keyword fallback: natural language delegation ──
    it('keyword fallback: "I\'ll forge this"', () => {
      const result = parseSuggestion("~88% I'll forge this complex auth refactor for you.");
      expect(result.action).toBe('forge');
    });

    it('keyword fallback: "let me brainstorm"', () => {
      const result = parseSuggestion("~87% Let me brainstorm on this architecture question.");
      expect(result.action).toBe('brainstorm');
    });

    it('keyword fallback: "this needs a tribunal"', () => {
      const result = parseSuggestion("~86% This needs a tribunal to settle the debate.");
      expect(result.action).toBe('tribunal');
    });

    it('keyword fallback: "launch a campfire"', () => {
      const result = parseSuggestion("~85% I suggest we launch a campfire discussion.");
      expect(result.action).toBe('campfire');
    });

    it('keyword fallback: "delegate to forge"', () => {
      const result = parseSuggestion("~89% I should delegate to forge for this task.");
      expect(result.action).toBe('forge');
    });

    it('keyword fallback: forge-hardened', () => {
      const result = parseSuggestion("~87% This warrants a forge-hardened run.");
      expect(result.action).toBe('forge');
      expect(result.hardened).toBe(true);
    });

    it('keyword fallback: team-forge', () => {
      const result = parseSuggestion("~86% Let me set up a team-forge competition.");
      expect(result.action).toBe('team-forge');
      expect(result.team).toBe(true);
    });

    it('keyword fallback: tribunal-adversarial', () => {
      const result = parseSuggestion("~85% A tribunal-adversarial debate would help here.");
      expect(result.action).toBe('tribunal');
      expect(result.tribunalMode).toBe('adversarial');
    });

    it('keyword fallback: does NOT match bare "forge" without intent', () => {
      const result = parseSuggestion("~95% The forge pattern is common in metallurgy and blacksmithing.");
      expect(result.action).toBeNull();
    });

    it('keyword fallback: does NOT match beyond 300 chars', () => {
      const padding = 'x'.repeat(300);
      const result = parseSuggestion(`${padding} I'll forge this task.`);
      expect(result.action).toBeNull();
    });

    it('[SUGGEST:mode] takes priority over keyword fallback', () => {
      const result = parseSuggestion("[SUGGEST:brainstorm] I'll forge this.");
      expect(result.action).toBe('brainstorm'); // marker wins, not keyword
    });
  });

  describe('parseConfidence', () => {
    it('parses ~X% at start', () => {
      const result = parseConfidence('~94% Here is the fix.');
      expect(result.value).toBe(94);
      expect(result.rest).toBe('Here is the fix.');
    });

    it('parses ~X% with suggestion after', () => {
      const result = parseConfidence('~91% [SUGGEST:forge] Competitive build needed.');
      expect(result.value).toBe(91);
      expect(result.rest).toBe('[SUGGEST:forge] Competitive build needed.');
    });

    it('parses low confidence', () => {
      const result = parseConfidence('~65% I cannot proceed without more context.');
      expect(result.value).toBe(65);
    });

    it('parses Confidence: 0.X format', () => {
      const result = parseConfidence('Confidence: 0.92 Here is my answer.');
      expect(result.value).toBe(92);
    });

    it('parses inline I\'m ~X% sure', () => {
      const result = parseConfidence('I\'m ~85% sure this is the right approach.');
      expect(result.value).toBe(85);
    });

    it('returns null when no confidence found', () => {
      const result = parseConfidence('Here is a normal response.');
      expect(result.value).toBeNull();
      expect(result.rest).toBe('Here is a normal response.');
    });

    it('handles empty string', () => {
      const result = parseConfidence('');
      expect(result.value).toBeNull();
    });
  });

  describe('confidenceBadge', () => {
    it('returns green for 94+', () => {
      const badge = confidenceBadge(96);
      expect(badge).toContain('96%');
      expect(badge).toContain('\x1b[32m'); // green
    });

    it('returns yellow for 90-93', () => {
      const badge = confidenceBadge(91);
      expect(badge).toContain('91%');
      expect(badge).toContain('\x1b[33m'); // yellow
    });

    it('returns orange for 70-89', () => {
      const badge = confidenceBadge(85);
      expect(badge).toContain('85%');
      expect(badge).toContain('\x1b[38;5;208m'); // orange
    });

    it('returns red for <70', () => {
      const badge = confidenceBadge(60);
      expect(badge).toContain('60%');
      expect(badge).toContain('\x1b[31m'); // red
    });
  });

  describe('CONFIDENCE_TIERS', () => {
    it('has correct thresholds', () => {
      expect(CONFIDENCE_TIERS.direct).toBe(93);
      expect(CONFIDENCE_TIERS.suggest).toBe(85);
      expect(CONFIDENCE_TIERS.nero).toBe(85);
      expect(CONFIDENCE_TIERS.stop).toBe(70);
    });
  });
});
