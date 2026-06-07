import { describe, it, expect } from 'vitest';
import { parseSuggestion, parseConfidence, confidenceBadge, CONFIDENCE_TIERS, CESAR_SYSTEM_PROMPT, buildReviewFollowupPrompt, detectNarratedToolStall } from '../../packages/cli/src/handlers/cesar-brain.js';
// Source of truth for these helpers is packages/cli/src/kern/cesar/brain-helpers.kern;
// the generated/*.js below is regenerated from it (npm run kern:compile) — do not edit by hand.
import { eagerFailedToolNames, shouldRunEagerRepairTool, shouldStopAfterXmlToolCall, splitBeforeToolMarkup, isUserDirectedQuestion, findTrailingUserQuestion, detectAwaitingUserInput, detectMutationIntentStall } from '../../packages/cli/src/generated/cesar/brain-helpers.js';
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

  describe('detectMutationIntentStall (false read-only hand-back)', () => {
    it('flags "I am read-only" narration with intent to apply a change', () => {
      expect(detectMutationIntentStall('This session is read-only, so I cannot apply the edit — paste it into your terminal.')).toBe(true);
      expect(detectMutationIntentStall("I can't write from here; the patch is ready to paste.")).toBe(true);
    });

    it('flags delegate-the-write-to-an-agent escape hatches', () => {
      expect(detectMutationIntentStall('I have no Edit tool, but I can spawn an agent to apply the change.')).toBe(true);
      expect(detectMutationIntentStall('Edit is not enabled in this context, so I will dispatch an agent to make the edits.')).toBe(true);
    });

    it('flags "you run it / git apply" hand-backs that intend a write', () => {
      expect(detectMutationIntentStall('The full patch is below — git apply it and run the tests.')).toBe(true);
    });

    it('does NOT flag a real write being performed (no hand-back)', () => {
      expect(detectMutationIntentStall('I edited brain.kern and the change is applied; tests pass.')).toBe(false);
    });

    it('does NOT flag a normal answer that merely discusses read-only behavior', () => {
      expect(detectMutationIntentStall('The investigation phase is read-only by design; that is expected and correct.')).toBe(false);
    });

    it('does NOT flag a legitimate clarifying question with no write intent', () => {
      expect(detectMutationIntentStall('Should I use approach A or approach B for the router?')).toBe(false);
    });
  });

  describe('isUserDirectedQuestion (auto-continuation stop signal)', () => {
    it('treats either/or forks as user-directed even without keyword triggers', () => {
      // The exact phrasings that previously looped (no keyword → misread as stuck).
      expect(isUserDirectedQuestion('Waiting on your call — plan the full 9-file modularization, or start with brain.kern first?')).toBe(true);
      expect(isUserDirectedQuestion('Start with brain.kern modularization only, or plan the full 9-file effort upfront?')).toBe(true);
    });

    it('treats keyword-addressed and "your call"-style questions as user-directed', () => {
      expect(isUserDirectedQuestion('Should I commit this as fix(cesar): drain timers?')).toBe(true);
      expect(isUserDirectedQuestion('Which file did you mean — brain.kern or dispatch.kern?')).toBe(true);
      expect(isUserDirectedQuestion('Ready to proceed?')).toBe(true);
      expect(isUserDirectedQuestion('Your call?')).toBe(true);
      expect(isUserDirectedQuestion('Either way works — up to you?')).toBe(true);
    });

    it('does NOT flag statements or rhetorical lines that are not questions to the user', () => {
      expect(isUserDirectedQuestion('I checked whether the cache or the store was stale.')).toBe(false); // no ?
      expect(isUserDirectedQuestion("Now I'll edit the file and run typecheck.")).toBe(false);
      expect(isUserDirectedQuestion('Done — brain.kern timers added, typecheck green.')).toBe(false);
      expect(isUserDirectedQuestion('')).toBe(false);
    });
  });

  describe('findTrailingUserQuestion (tail scan for the ask-then-advise shape)', () => {
    it('finds a user question followed by a recommendation/rationale (the bug shape)', () => {
      const resp = [
        'Here is what I found.',
        'Should I rename the source, or leave it alone?',
        'My recommendation: rename now — it is cheap and reversible.',
      ].join('\n');
      expect(findTrailingUserQuestion(resp)).toBe('Should I rename the source, or leave it alone?');
    });

    it('finds a fork question followed by a confidence line (minimax shape)', () => {
      const resp = [
        'Rename now, or stop before the serializer?',
        'Confidence: ~93% — high confidence in the rename.',
      ].join('\n');
      expect(findTrailingUserQuestion(resp)).toBe('Rename now, or stop before the serializer?');
    });

    it('still finds a question on the last line (last-line case preserved)', () => {
      expect(findTrailingUserQuestion('All set.\nReady to proceed?')).toBe('Ready to proceed?');
    });

    it('returns null when there is no user-directed question in the tail', () => {
      expect(findTrailingUserQuestion('I edited brain.kern and ran typecheck — all green.')).toBeNull();
    });

    it('returns the question even when the model also narrates an action nearby', () => {
      // We deliberately do NOT suppress on "the model proceeded" — that produced
      // false positives that hid real questions. A trailing question wins; it just
      // stops auto-continuation (benign when the model is already done).
      expect(findTrailingUserQuestion('I renamed the file.\nShould I also update the tests?')).toBe('Should I also update the tests?');
      expect(findTrailingUserQuestion('Should I rename it, or leave it?\nI\'d rename it and update the docs too.')).toBe('Should I rename it, or leave it?');
    });

    it('does NOT catch a question buried above the last 6 non-empty lines', () => {
      const resp = [
        'Should I rename it, or leave it?', // line 1 — too far up
        'line2', 'line3', 'line4', 'line5', 'line6', 'line7 — done.',
      ].join('\n');
      expect(findTrailingUserQuestion(resp)).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(findTrailingUserQuestion('')).toBeNull();
    });

    it('handles null/undefined input safely', () => {
      expect(findTrailingUserQuestion(undefined as unknown as string)).toBeNull();
      expect(findTrailingUserQuestion(null as unknown as string)).toBeNull();
    });

    it('finds a question exactly at the 6-non-empty-line boundary, not beyond it', () => {
      // 6th line from the end → inside the window → found.
      expect(findTrailingUserQuestion(['Should I proceed?', 'a', 'b', 'c', 'd', 'e'].join('\n'))).toBe('Should I proceed?');
      // 7th line from the end → outside the window → null.
      expect(findTrailingUserQuestion(['Should I proceed?', 'a', 'b', 'c', 'd', 'e', 'f'].join('\n'))).toBeNull();
    });
  });

  describe('detectAwaitingUserInput (plan-execution stall/await signal)', () => {
    it('detects "holding / awaiting greenlight" statements that have NO question mark', () => {
      expect(detectAwaitingUserInput('Holding — awaiting your greenlight before the implementation steps.')).toBe(true);
      expect(detectAwaitingUserInput("I'll hold for your greenlight rather than auto-firing step 3.")).toBe(true);
      expect(detectAwaitingUserInput('Both specs are on disk.\nThe implementation steps need explicit user approval.')).toBe(true);
      expect(detectAwaitingUserInput('Holding. Same state: awaiting user greenlight to begin step 3.')).toBe(true);
    });

    it('detects a trailing user-directed question (reuses findTrailingUserQuestion)', () => {
      expect(detectAwaitingUserInput('Ready to proceed?')).toBe(true);
    });

    it('does NOT fire on ordinary completion / progress text', () => {
      expect(detectAwaitingUserInput('Done — I created the files and the tests pass.')).toBe(false);
      expect(detectAwaitingUserInput('I edited brain.kern and ran the build; all green.')).toBe(false);
      expect(detectAwaitingUserInput('The server is waiting for the next request.')).toBe(false); // not user-directed
      expect(detectAwaitingUserInput('')).toBe(false);
    });

    it('does NOT fire on greenlight-received or polite "let me know" closers (tightened)', () => {
      expect(detectAwaitingUserInput('I received the greenlight and am starting now.')).toBe(false);
      expect(detectAwaitingUserInput('Done. Let me know if you want more test coverage.')).toBe(false);
      expect(detectAwaitingUserInput('The greenlight is on; proceeding.')).toBe(false);
    });

    it('still detects a holding/awaiting line behind a markdown list or quote marker', () => {
      expect(detectAwaitingUserInput('- Holding for your input on the rename.')).toBe(true);
      expect(detectAwaitingUserInput('1. Awaiting your approval before step 3.')).toBe(true);
    });

    it('does NOT fire on "Holding <noun>" / "Holding the lock" / "waiting/awaiting your <noun>"', () => {
      expect(detectAwaitingUserInput('Holding references to assets in the bundle.')).toBe(false);
      expect(detectAwaitingUserInput('Holding the lock until the write completes.')).toBe(false);
      expect(detectAwaitingUserInput('The job is waiting for your files to upload.')).toBe(false);
      expect(detectAwaitingUserInput('Awaiting your files from the previous step.')).toBe(false);
      expect(detectAwaitingUserInput('Awaiting your branch build to finish.')).toBe(false);
      // bare "awaiting input/response" (no user qualifier) = runtime status, not a user stall
      expect(detectAwaitingUserInput('Awaiting input from the upstream API.')).toBe(false);
      expect(detectAwaitingUserInput('Awaiting response from the server.')).toBe(false);
    });

    it('DOES fire on "awaiting your input/response" (user-qualified)', () => {
      expect(detectAwaitingUserInput('Blocked — awaiting your input on the schema.')).toBe(true);
      expect(detectAwaitingUserInput('Awaiting approval before I delete the table.')).toBe(true);
    });

    it('detects spaced "go ahead" / "sign off" stall phrasings', () => {
      expect(detectAwaitingUserInput('Blocked — I need your sign off before deleting.')).toBe(true);
      expect(detectAwaitingUserInput('Awaiting your go ahead to merge.')).toBe(true);
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

    it('read-only orchestration tools are marked safe', () => {
      const tools = [createForgeTool(), createBrainstormTool(), createTribunalTool(), createCampfireTool(), createReportConfidenceTool()];
      for (const t of tools) {
        expect(t.definition.isReadOnly).toBe(true);
        expect(t.definition.isConcurrencySafe).toBe(true);
        expect(t.checkPermission({}, {} as any).behavior).toBe('allow');
      }
    });

    it('Pipeline is marked mutating because it can apply review fixes', () => {
      const tool = createPipelineTool();
      expect(tool.definition.isReadOnly).toBe(false);
      expect(tool.definition.isConcurrencySafe).toBe(false);
      expect(tool.checkPermission({}, {} as any).behavior).toBe('allow');
    });
  });
});
