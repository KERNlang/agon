import { describe, it, expect } from 'vitest';
import { parseSuggestion, parseConfidence, confidenceBadge, CONFIDENCE_TIERS, CESAR_SYSTEM_PROMPT, buildReviewFollowupPrompt, detectNarratedToolStall } from '../../packages/cli/src/handlers/cesar-brain.js';
import { eagerFailedToolNames, shouldRunEagerRepairTool, shouldStopAfterXmlToolCall, splitBeforeToolMarkup } from '../../packages/cli/src/generated/cesar/brain.js';
import { createReportConfidenceTool, createForgeTool, createBrainstormTool, createTribunalTool, createCampfireTool, createPipelineTool } from '../../packages/core/src/tools.js';

describe('Cesar Brain', () => {
  describe('splitBeforeToolMarkup', () => {
    it('keeps visible text before XML tool markup and suppresses the markup', () => {
      expect(splitBeforeToolMarkup('Checking.\n<tool name="Read">{"file_path":"a.ts"}</tool>')).toEqual({
        visible: 'Checking.\n',
        hasToolMarkup: true,
      });
    });

    it('detects Gemini-style tool markup', () => {
      const result = splitBeforeToolMarkup('<tool_call_tool>{"name":"Read","arguments":{}}</tool_call_tool>');
      expect(result.hasToolMarkup).toBe(true);
      expect(result.visible).toBe('');
    });
  });

  describe('detectNarratedToolStall', () => {
    it('detects read/search narration without a real tool call', () => {
      expect(detectNarratedToolStall('Let me read packages/cli/src/kern/cesar/brain.kern first.')).toBe(true);
      expect(detectNarratedToolStall('I should search for pendingDelegation in the codebase.')).toBe(true);
    });

    it('detects fake approval/tool-blocking narration', () => {
      expect(detectNarratedToolStall('The Edit tool keeps blocking me, I need user approval.')).toBe(true);
    });

    it('does not flag normal answers', () => {
      expect(detectNarratedToolStall('The tools are wired, but Kimi may be weak at native tool calls.')).toBe(false);
    });
  });

  describe('eager tool repair loop guards', () => {
    it('limits repair retries to failed tools and only once per tool', () => {
      const failedNames = eagerFailedToolNames([
        { toolName: 'Read', result: { ok: false, error: 'Malformed JSON', content: '' } },
        { toolName: 'Grep', result: { ok: true, content: 'ok' } },
        { toolName: 'Read', result: { ok: false, error: 'Still bad', content: '' } },
      ] as any);

      expect(failedNames).toEqual(['Read']);
      expect(shouldRunEagerRepairTool('Read', { status: 'running', input: { file_path: 'a.ts' } }, failedNames, [])).toBe(true);
      expect(shouldRunEagerRepairTool('Read', { status: 'running', input: { file_path: 'a.ts' } }, failedNames, ['Read'])).toBe(false);
      expect(shouldRunEagerRepairTool('Grep', { status: 'running', input: { pattern: 'x' } }, failedNames, [])).toBe(false);
      expect(shouldRunEagerRepairTool('Read', { status: 'done', input: { file_path: 'a.ts' } }, failedNames, [])).toBe(false);
    });
  });

  describe('shouldStopAfterXmlToolCall', () => {
    it('stops the XML loop for orchestration handoff tools', () => {
      for (const tool of ['Forge', 'Brainstorm', 'Tribunal', 'Campfire', 'Pipeline', 'Review', 'Agent', 'ProposePlan']) {
        expect(shouldStopAfterXmlToolCall(tool)).toBe(true);
      }
    });

    it('does not stop for inline workspace tools', () => {
      for (const tool of ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'ReportConfidence']) {
        expect(shouldStopAfterXmlToolCall(tool)).toBe(false);
      }
    });
  });

  describe('buildReviewFollowupPrompt', () => {
    it('grounds bare "fix it" in the latest review findings', () => {
      const result = buildReviewFollowupPrompt('fix it with codex?', {
        lastReviewResult: {
          engineId: 'minimax',
          target: 'uncommitted',
          label: 'uncommitted changes',
          diff: 'diff --git a/a.ts b/a.ts',
          reviewOutput: '1. Blocking bug in status timer\n2. Missing export on AgonTip',
          timestamp: Date.now(),
        },
      } as any);

      expect(result.matched).toBe(true);
      expect(result.prompt).toContain('MOST RECENT code review');
      expect(result.prompt).toContain('Review engine: minimax');
      expect(result.prompt).toContain('Preferred implementation engine: codex');
      expect(result.prompt).toContain('Blocking bug in status timer');
    });

    it('ignores stale review results for generic follow-ups', () => {
      const result = buildReviewFollowupPrompt('fix it', {
        lastReviewResult: {
          engineId: 'minimax',
          target: 'uncommitted',
          label: 'uncommitted changes',
          diff: '',
          reviewOutput: 'old review',
          timestamp: Date.now() - (31 * 60 * 1000),
        },
      } as any);

      expect(result).toEqual({ matched: false, prompt: 'fix it' });
    });
  });

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

    // NL-phrase fallback was removed — parser now only honors explicit [SUGGEST:mode] / [DELEGATE:mode] markers.
    it('does not match natural-language intent without an explicit marker', () => {
      expect(parseSuggestion("~88% I'll forge this refactor for you.").action).toBeNull();
      expect(parseSuggestion("~87% Let me brainstorm on this.").action).toBeNull();
      expect(parseSuggestion("~86% This needs a tribunal.").action).toBeNull();
      expect(parseSuggestion("~85% I suggest we launch a campfire.").action).toBeNull();
    });

    it('ignores bare mode words in descriptive prose', () => {
      expect(parseSuggestion("~95% The forge pattern is common in metallurgy.").action).toBeNull();
      expect(parseSuggestion("~95% Team-forge pits two teams against each other.").action).toBeNull();
    });

    it('explicit [SUGGEST:mode] still parses even when the rest mentions other modes', () => {
      const result = parseSuggestion("[SUGGEST:brainstorm] I'll forge this.");
      expect(result.action).toBe('brainstorm');
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
      expect(CONFIDENCE_TIERS.direct).toBe(96);
      expect(CONFIDENCE_TIERS.quickNero).toBe(93);
      expect(CONFIDENCE_TIERS.nero).toBe(88);
      expect(CONFIDENCE_TIERS.brainstorm).toBe(72);
      expect(CONFIDENCE_TIERS.advisor).toBe(72);
    });
  });

  describe('CESAR_SYSTEM_PROMPT', () => {
    it('references ReportConfidence tool', () => {
      expect(CESAR_SYSTEM_PROMPT).toContain('ReportConfidence');
    });

    it('references delegation tools', () => {
      expect(CESAR_SYSTEM_PROMPT).toContain('Forge');
      expect(CESAR_SYSTEM_PROMPT).toContain('Brainstorm');
      expect(CESAR_SYSTEM_PROMPT).toContain('Tribunal');
      expect(CESAR_SYSTEM_PROMPT).toContain('Campfire');
      expect(CESAR_SYSTEM_PROMPT).toContain('Pipeline');
    });

    it('instructs STOP after delegation', () => {
      expect(CESAR_SYSTEM_PROMPT).toContain('STOP');
    });

    it('mentions team and hardened variants', () => {
      expect(CESAR_SYSTEM_PROMPT).toContain('team=true');
      expect(CESAR_SYSTEM_PROMPT).toContain('hardened=true');
    });
  });

  describe('Orchestration signal tools', () => {
    it('ReportConfidence validates value range', () => {
      const tool = createReportConfidenceTool();
      expect(tool.definition.name).toBe('ReportConfidence');
      expect(tool.validate({ value: 92 }, {} as any)).toBeNull();
      expect(tool.validate({ value: -1 }, {} as any)).toContain('0 and 100');
      expect(tool.validate({ value: 101 }, {} as any)).toContain('0 and 100');
      expect(tool.validate({}, {} as any)).toContain('value');
    });

    it('ReportConfidence returns tier guidance', async () => {
      const tool = createReportConfidenceTool();
      const high = await tool.execute({ value: 95 }, {} as any);
      expect(high.ok).toBe(true);
      expect(high.content).toContain('Proceed');
      const low = await tool.execute({ value: 60 }, {} as any);
      expect(low.content).toContain('STOP');
    });

    it('Forge requires task param', () => {
      const tool = createForgeTool();
      expect(tool.validate({ task: 'fix auth' }, {} as any)).toBeNull();
      expect(tool.validate({}, {} as any)).toContain('task');
      expect(tool.validate({ task: '' }, {} as any)).toContain('task');
    });

    it('Tribunal validates mode enum', () => {
      const tool = createTribunalTool();
      expect(tool.validate({ question: 'which?', mode: 'adversarial' }, {} as any)).toBeNull();
      expect(tool.validate({ question: 'which?', mode: 'invalid' }, {} as any)).toContain('Invalid mode');
    });

    it('all orchestration tools are read-only', () => {
      const tools = [createForgeTool(), createBrainstormTool(), createTribunalTool(), createCampfireTool(), createPipelineTool(), createReportConfidenceTool()];
      for (const t of tools) {
        expect(t.definition.isReadOnly).toBe(true);
        expect(t.definition.isConcurrencySafe).toBe(true);
        expect(t.checkPermission({}, {} as any).behavior).toBe('allow');
      }
    });
  });
});
