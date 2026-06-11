import { describe, it, expect } from 'vitest';
import { parseSuggestion, parseConfidence, confidenceBadge, CONFIDENCE_TIERS, CESAR_SYSTEM_PROMPT, buildReviewFollowupPrompt, detectNarratedToolStall, extractStrictConfidence, buildEscalationSuggestionLine, ESCALATION_SUGGESTION_THRESHOLD } from '../../packages/cli/src/handlers/cesar-brain.js';
// Source of truth for these helpers is packages/cli/src/kern/cesar/brain-helpers.kern;
// the generated/*.js below is regenerated from it (npm run kern:compile) — do not edit by hand.
import { eagerFailedToolNames, shouldRunEagerRepairTool, shouldStopAfterXmlToolCall, splitBeforeToolMarkup, isUserDirectedQuestion, findTrailingUserQuestion, detectAwaitingUserInput, detectMutationIntentStall, detectFabricatedDelegation, stripNonAssertionSpans, shouldDeescalateGuard, isBashToolName, isWriteToolName, stripAgonToolPrefix } from '../../packages/cli/src/generated/cesar/brain-helpers.js';
import { createReportConfidenceTool, createForgeTool, createBrainstormTool, createTribunalTool, createCampfireTool, createPipelineTool } from '../../packages/core/src/tools.js';
// Rigid DECISION/CONFIDENCE parser for ACTUALLY-FIRED nero/advisor results — C4
// must leave this untouched (downstream escalation routing depends on it).
import { parseQuickNeroDecision } from '../../packages/cli/src/generated/cesar/escalation.js';

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

  describe('detectFabricatedDelegation (confabulated dispatch)', () => {
    it('flags a claim that reviewers/jobs are running or were dispatched', () => {
      // Real phrases from the confabulation transcript.
      expect(detectFabricatedDelegation('Going — three reviewers (codex, claude, agy) are reading the 90-file diff in parallel.')).toBe(true);
      expect(detectFabricatedDelegation('The review is still running — codex, claude, and agy are each reading the diff in parallel.')).toBe(true);
      expect(detectFabricatedDelegation("Review delegated to codex, claude, and agy. I'll get back when they report.")).toBe(true);
      expect(detectFabricatedDelegation('I kicked off the review — the agents are working in parallel now.')).toBe(true);
    });

    it('does not flag a plain answer that merely mentions a review', () => {
      expect(detectFabricatedDelegation('You should run a review before merging this branch.')).toBe(false);
      expect(detectFabricatedDelegation('The review tool diffs the branch against its base.')).toBe(false);
      expect(detectFabricatedDelegation('Here is the fix; nothing is running right now.')).toBe(false);
    });

    it('requires both a delegable target AND a dispatch/running claim', () => {
      // "running" but no delegable target → not a fabricated delegation.
      expect(detectFabricatedDelegation('The build is running in parallel across packages.')).toBe(false);
      // target but no dispatch claim → not flagged.
      expect(detectFabricatedDelegation('A tribunal would surface the tradeoffs here.')).toBe(false);
    });

    it('still flags an actor-less running-status lie (codex adversarial case)', () => {
      expect(detectFabricatedDelegation('Background review in progress. Diff analysis is running now. Results soon.')).toBe(true);
      expect(detectFabricatedDelegation('A tribunal review is currently running.')).toBe(true);
    });

    it('does NOT flag a description OF the harness (the 2026-06-11 incident class)', () => {
      // The richer harness description that tripped the old bare-vocabulary guard.
      expect(detectFabricatedDelegation('Agon runs a read-only investigation phase first; the Edit and Write tools unlock after approval. Forge dispatches engines that work in parallel in isolated worktrees and report back with a winner.')).toBe(false);
      expect(detectFabricatedDelegation('It handles orchestration modes like Forge and Tribunal via isolated worktrees, and engines compete in parallel during a forge run.')).toBe(false);
    });

    it('does NOT flag quoted failure text being discussed (debug conversation)', () => {
      expect(detectFabricatedDelegation('Why did the agent say "the review is still running" yesterday? Nothing was dispatched.')).toBe(false);
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

    it('still flags a result-first stall with no first-person intent (codex adversarial case)', () => {
      expect(detectMutationIntentStall('Patch ready. Please apply it manually; this environment is read-only.')).toBe(true);
    });

    it('does NOT flag a description OF the harness (the 2026-06-11 incident class)', () => {
      // The exact answer shape that derailed the kern-game-studio session.
      expect(detectMutationIntentStall('The Agon harness is a runtime layer that mediates between AI engines and your codebase. It provides sandboxed tool access (Read/Edit/Write/Bash/Grep) with approval gating for writes, enforces read-before-edit rules, runs auto-verification after changes, and handles orchestration modes like Forge and Tribunal via isolated worktrees.')).toBe(false);
      expect(detectMutationIntentStall('Agon runs a read-only investigation phase first; the Edit and Write tools unlock after approval.')).toBe(false);
    });

    it('does NOT flag quoted failure text being discussed (debug conversation)', () => {
      expect(detectMutationIntentStall('The engine said "paste it into your terminal" and "I cannot apply the edit" — that is the stall we are debugging.')).toBe(false);
    });
  });

  describe('stripNonAssertionSpans (Layer 1: quoted/demonstrated text is not a claim)', () => {
    it('strips fenced code, backtick spans, double quotes, and tool enumerations', () => {
      expect(stripNonAssertionSpans('see ```\nI cannot write\n``` for details')).not.toContain('cannot write');
      expect(stripNonAssertionSpans('the tools (Read/Edit/Write/Bash) are gated')).not.toContain('Edit');
      expect(stripNonAssertionSpans('it printed "apply it manually" yesterday')).not.toContain('apply it manually');
      expect(stripNonAssertionSpans('run `git apply` yourself')).not.toContain('git apply');
    });

    it('keeps a quoted span that is itself an active first-person claim (anti-hiding carve-out)', () => {
      expect(stripNonAssertionSpans('`I\'ll edit foo.ts next`')).toContain("I'll edit foo.ts next");
    });

    it('does not let contraction apostrophes pair up as quotes', () => {
      const s = "I can't write from here; the patch is ready and you don't need more context.";
      expect(stripNonAssertionSpans(s)).toContain("can't write");
      expect(stripNonAssertionSpans(s)).toContain('patch is ready');
    });
  });

  describe('shouldDeescalateGuard (Layer 3: warn-only, never suppress, fail-open)', () => {
    it('de-escalates only on conversational intake+flow with no mutating tool', () => {
      expect(shouldDeescalateGuard({ intakeKind: 'chat', recommendedFlow: 'answer', usedMutatingTool: false })).toBe(true);
      expect(shouldDeescalateGuard({ intakeKind: 'exploration', recommendedFlow: 'campfire', usedMutatingTool: false })).toBe(true);
      expect(shouldDeescalateGuard({ intakeKind: 'exploration', recommendedFlow: 'brainstorm', usedMutatingTool: false })).toBe(true);
    });

    it('fails open (full nudge) on task intakes, escalated flows, mutating tools, or missing signals', () => {
      expect(shouldDeescalateGuard({ intakeKind: 'big-feature', recommendedFlow: 'plan-first', usedMutatingTool: false })).toBe(false);
      // chat intake the router escalated to a non-answer flow does NOT de-escalate.
      expect(shouldDeescalateGuard({ intakeKind: 'chat', recommendedFlow: 'quick-fix', usedMutatingTool: false })).toBe(false);
      expect(shouldDeescalateGuard({ intakeKind: 'chat', recommendedFlow: 'answer', usedMutatingTool: true })).toBe(false);
      expect(shouldDeescalateGuard({ intakeKind: 'chat', recommendedFlow: 'answer' })).toBe(false);
      expect(shouldDeescalateGuard({ intakeKind: 'chat' })).toBe(false);
      expect(shouldDeescalateGuard({})).toBe(false);
    });
  });

  describe('watchdogs — review-verified recall cases (round 2)', () => {
    it('mutation stall: past-tense and artifact-presentation hand-backs still fire', () => {
      expect(detectMutationIntentStall('I made the change; apply this diff in your terminal.')).toBe(true);
      expect(detectMutationIntentStall('Here is the diff; git apply it.')).toBe(true);
      expect(detectMutationIntentStall('I already updated the file; copy-paste this patch.')).toBe(true);
    });

    it('fabricated delegation: passive/elliptical dispatch claims still fire', () => {
      expect(detectFabricatedDelegation('The review was queued.')).toBe(true);
      expect(detectFabricatedDelegation('The team of reviewers has been kicked off.')).toBe(true);
      expect(detectFabricatedDelegation('Agents are on it.')).toBe(true);
    });

    it('a completed write with no hand-back still does not fire', () => {
      expect(detectMutationIntentStall('I edited brain.kern and the change is applied; tests pass.')).toBe(false);
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

  describe('verify-before-done gate tool classification (native + MCP aliases)', () => {
    describe('stripAgonToolPrefix', () => {
      it('strips the Agon orchestration alias prefix case-insensitively', () => {
        expect(stripAgonToolPrefix('AgonBash')).toBe('Bash');
        expect(stripAgonToolPrefix('AgonEdit')).toBe('Edit');
        expect(stripAgonToolPrefix('agonwrite')).toBe('write');
      });
      it('leaves bare names and non-Agon names untouched', () => {
        expect(stripAgonToolPrefix('Bash')).toBe('Bash');
        expect(stripAgonToolPrefix('Edit')).toBe('Edit');
        expect(stripAgonToolPrefix('Agent')).toBe('Agent'); // not the 'Agon' prefix
        expect(stripAgonToolPrefix('')).toBe('');
      });
    });

    describe('isBashToolName', () => {
      it('recognizes a shell call on the native/XML path (bare Bash)', () => {
        expect(isBashToolName('Bash')).toBe(true);
        expect(isBashToolName('bash')).toBe(true);
      });
      it('recognizes a shell call on the default companion/MCP path (AgonBash)', () => {
        expect(isBashToolName('AgonBash')).toBe(true);
        expect(isBashToolName('agonbash')).toBe(true);
      });
      it('does not treat non-shell tools as bash', () => {
        for (const t of ['Edit', 'Write', 'AgonEdit', 'AgonWrite', 'Read', 'SaveMemory', 'Agent']) {
          expect(isBashToolName(t)).toBe(false);
        }
      });
    });

    describe('isWriteToolName', () => {
      it('counts native write tools as project write-work', () => {
        for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
          expect(isWriteToolName(t)).toBe(true);
        }
      });
      it('counts the MCP orchestration aliases as project write-work', () => {
        for (const t of ['AgonEdit', 'AgonWrite', 'agonedit', 'AGONWRITE']) {
          expect(isWriteToolName(t)).toBe(true);
        }
      });
      it('does NOT count SaveMemory or shell/read tools as write-work', () => {
        for (const t of ['SaveMemory', 'Bash', 'AgonBash', 'Read', 'Grep', 'Glob', 'ReportConfidence']) {
          expect(isWriteToolName(t)).toBe(false);
        }
      });
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

  // ── C4: escalation softening — strict-anchored confidence + soft suggestion line ──
  describe('extractStrictConfidence (strict CONFIDENCE: NN% anchor only)', () => {
    it('extracts from a CONFIDENCE: NN% anchor', () => {
      expect(extractStrictConfidence('CONFIDENCE: 72%')).toBe(72);
      expect(extractStrictConfidence('Here is the plan.\nCONFIDENCE: 84%')).toBe(84);
    });

    it('is case-insensitive and tolerates ~ and inner spacing', () => {
      expect(extractStrictConfidence('confidence: 80%')).toBe(80);
      expect(extractStrictConfidence('CONFIDENCE: ~66 %')).toBe(66);
    });

    it('does NOT scrape loose prose like "72% sure"', () => {
      expect(extractStrictConfidence("I'm 72% sure this is right.")).toBeNull();
      expect(extractStrictConfidence('about 72% of the way there')).toBeNull();
      expect(extractStrictConfidence('~72% — leading marker, not the anchor')).toBeNull();
      expect(extractStrictConfidence('Confidence: 0.72 here')).toBeNull(); // decimal form is not the strict anchor
    });

    it('returns null for no anchor / empty / out-of-range', () => {
      expect(extractStrictConfidence('Here is a normal response.')).toBeNull();
      expect(extractStrictConfidence('')).toBeNull();
      expect(extractStrictConfidence(undefined as unknown as string)).toBeNull();
      expect(extractStrictConfidence('CONFIDENCE: 250%')).toBeNull();
    });
  });

  describe('ESCALATION_SUGGESTION_THRESHOLD + suggestion-line gating', () => {
    it('threshold is 85 (below ~85% earns a line)', () => {
      expect(ESCALATION_SUGGESTION_THRESHOLD).toBe(85);
    });

    // The brain.kern gate is `strictConf < ESCALATION_SUGGESTION_THRESHOLD`.
    // 84 → line, 85/90 → none (fail toward silence at/above threshold).
    it('84 is below threshold (line); 85 and 90 are not (no line)', () => {
      expect(extractStrictConfidence('CONFIDENCE: 84%')! < ESCALATION_SUGGESTION_THRESHOLD).toBe(true);
      expect(extractStrictConfidence('CONFIDENCE: 85%')! < ESCALATION_SUGGESTION_THRESHOLD).toBe(false);
      expect(extractStrictConfidence('CONFIDENCE: 90%')! < ESCALATION_SUGGESTION_THRESHOLD).toBe(false);
    });

    it('no anchor means no line (fail toward silence)', () => {
      // A turn with only prose confidence never crosses the strict gate.
      expect(extractStrictConfidence("I'm 70% sure but no anchor.")).toBeNull();
    });
  });

  describe('buildEscalationSuggestionLine (dim in-flow one-liner)', () => {
    it('renders a dim line offering nero/tribunal with the percent', () => {
      const line = buildEscalationSuggestionLine(72);
      expect(line).toContain('72% — want a nero/tribunal on this?');
      expect(line).toContain('\x1b[2m'); // dim
      expect(line).toContain('\x1b[0m'); // reset
    });

    it('has no modal/menu framing — it is just the suggestion text', () => {
      const line = buildEscalationSuggestionLine(80);
      expect(line).not.toMatch(/\b(y\/n|press|choose|option|\[1\.)/i);
    });
  });

  // C4 guardrail: the rigid DECISION/CONFIDENCE parser for FIRED nero/advisor
  // results must stay intact — softening only changed the AUTO-interrupt path.
  describe('parseQuickNeroDecision (fired-result parser — must stay untouched)', () => {
    it('still parses a structured self-check verdict', () => {
      const out = parseQuickNeroDecision([
        'CONFIDENCE: ~70%',
        'DECISION: tribunal',
        'BREADTH: team',
        'FORGE_SCOPE: none',
        'WHY: real tradeoff between session tokens and JWT',
        'CHECK: token-revocation story is unproven',
      ].join('\n'));
      expect(out.decision).toBe('tribunal');
      expect(out.team).toBe(true);
      expect(out.scope).toBe('none');
      expect(out.rationale).toContain('tradeoff');
    });

    it('defaults to self when no DECISION line is present', () => {
      const out = parseQuickNeroDecision('Looks fine to me, no structured verdict here.');
      expect(out.decision).toBe('self');
      expect(out.team).toBe(false);
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

    // C3: concise-output contract lives inside the TURN CLOSURE section.
    it('carries the LEAD WITH FINDINGS concise-output principle', () => {
      expect(CESAR_SYSTEM_PROMPT).toContain('LEAD WITH FINDINGS');
      expect(CESAR_SYSTEM_PROMPT).toContain('FIRST sentence');
      // GOOD/BAD example pair present
      expect(CESAR_SYSTEM_PROMPT).toMatch(/GOOD:/);
      expect(CESAR_SYSTEM_PROMPT).toMatch(/BAD:/);
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
