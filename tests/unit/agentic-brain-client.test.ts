import { describe, it, expect } from 'vitest';

import {
  AgenticTurnBrainClient,
  createAgenticTurnBrainClient,
  parseAgentToolCall,
  extractNativeToolCall,
  unwrapToolInputEnvelope,
  toolFieldNames,
  capsToNativeTools,
  normalizeToolSchema,
  sanitizeSchemaNode,
  buildAgentSystemPrompt,
  renderAgentTranscript,
  renderAgentMessages,
  AGENT_MSG_KEEP_FULL,
  describeAgentAction,
  looksLikeActionIntent,
  looksLikeDeferral,
  AGENT_TOOL_MARKER as MARK,
} from '../../packages/cli/src/generated/bridge/agentic-brain-client.js';
import type { BrainEvent, BrainTurnResult, EngineAdapter, EngineRegistry, CapabilitySpec } from '@kernlang/agon-core';

// The agent brain runs a ReAct loop over adapter.dispatch. We inject a fake adapter
// that returns SCRIPTED stdout per step (a queue; past the end it repeats the last,
// so a mis-scripted test ends rather than loops). No engine is spawned.
function makeAgent(responses: string[]): AgenticTurnBrainClient {
  let i = 0;
  const registry = { get: (id: string) => ({ id }), listIds: () => ['claude', 'codex'] } as unknown as EngineRegistry;
  const client = new AgenticTurnBrainClient(registry);
  (client as unknown as { adapter: EngineAdapter }).adapter = {
    dispatch: async () => ({ exitCode: 0, stdout: responses[Math.min(i++, responses.length - 1)], stderr: '', durationMs: 1, timedOut: false }),
    isAvailable: async () => true,
  } as unknown as EngineAdapter;
  return client;
}

const readSpec = (name = 'readPage'): CapabilitySpec => ({ name, description: 'read the page', inputSchema: {}, isReadOnly: true });
const actSpec = (name = 'click'): CapabilitySpec => ({ name, description: 'click an element', inputSchema: { selector: 'string' }, isReadOnly: false, isDestructive: true });
const req = (turnId: string, input = 'do something') => ({ sessionId: 's', turnId, clientId: 'c', input });

// Drive the turn to completion, auto-answering each capability/approval request.
// The response is scheduled on a microtask so it lands while the generator's
// `await waitForX` (set up synchronously inside the next gen.next()) is pending.
async function driveAgent(
  client: AgenticTurnBrainClient,
  gen: AsyncGenerator<BrainEvent, BrainTurnResult, void>,
  responders: { capability: (ev: BrainEvent) => { ok: boolean; output?: string; error?: string }; approval: (ev: BrainEvent) => string; question?: (ev: BrainEvent) => string },
): Promise<{ events: BrainEvent[]; result: BrainTurnResult }> {
  const events: BrainEvent[] = [];
  let r = await gen.next();
  while (!r.done) {
    const ev = r.value;
    events.push(ev);
    if (ev.kind === 'capability-request') {
      const reqId = (ev as { requestId: string }).requestId;
      const resp = responders.capability(ev);
      queueMicrotask(() => { void client.provideCapabilityResult({ sessionId: 's', requestId: reqId, clientId: 'c', ...resp }); });
    } else if (ev.kind === 'approval-request') {
      const reqId = (ev as { requestId: string }).requestId;
      const decision = responders.approval(ev) as 'approve' | 'approve-session' | 'deny' | 'deny-session' | 'abort';
      queueMicrotask(() => { void client.provideApproval({ sessionId: 's', requestId: reqId, clientId: 'c', decision }); });
    } else if (ev.kind === 'question-request') {
      const reqId = (ev as { requestId: string }).requestId;
      const answer = responders.question ? responders.question(ev) : 'yes, go ahead';
      queueMicrotask(() => { void client.provideAnswer({ sessionId: 's', requestId: reqId, clientId: 'c', answer }); });
    }
    r = await gen.next();
  }
  return { events, result: r.value };
}

describe('parseAgentToolCall — forgiving sentinel extraction', () => {
  it('extracts a clean tool call', () => {
    expect(parseAgentToolCall(`${MARK} {"name":"click","input":{"selector":"#buy"}}`)).toEqual({ name: 'click', input: { selector: '#buy' } });
  });
  it('tolerates surrounding prose and a code fence', () => {
    expect(parseAgentToolCall(`Let me look.\n\`\`\`\n${MARK} {"name":"readPage","input":{}}\n\`\`\``)).toEqual({ name: 'readPage', input: {} });
  });
  it('handles nested braces in input', () => {
    expect(parseAgentToolCall(`${MARK} {"name":"type","input":{"opts":{"a":1}}}`)).toEqual({ name: 'type', input: { opts: { a: 1 } } });
  });
  it('defaults input to {} when omitted', () => {
    expect(parseAgentToolCall(`${MARK} {"name":"readPage"}`)).toEqual({ name: 'readPage', input: {} });
  });
  it('returns null when there is no sentinel (a final prose answer)', () => {
    expect(parseAgentToolCall('Here is your final answer.')).toBeNull();
  });
  it('returns null on garbled JSON', () => {
    expect(parseAgentToolCall(`${MARK} {name: click}`)).toBeNull();
  });
  it('returns null when the object has no string name', () => {
    expect(parseAgentToolCall(`${MARK} {"input":{}}`)).toBeNull();
  });
});

describe('agent prompt + transcript helpers', () => {
  it('buildAgentSystemPrompt lists tools with read-only vs acts tags and the protocol', () => {
    const p = buildAgentSystemPrompt([readSpec(), actSpec()]);
    expect(p).toContain('readPage');
    expect(p).toContain('(read-only)');
    expect(p).toContain('click');
    expect(p).toContain('ACTS on the page');
    expect(p).toContain(MARK);
  });
  it('buildAgentSystemPrompt prepends a base system prompt and notes when no tools', () => {
    const p = buildAgentSystemPrompt([], 'BASE-PROMPT');
    expect(p.startsWith('BASE-PROMPT')).toBe(true);
    expect(p).toContain('none registered');
  });
  it('renderAgentTranscript frames the request as a GOAL and shows the running tool history', () => {
    expect(renderAgentTranscript('hello', [])).toContain('Nothing done yet');
    const t = renderAgentTranscript('hello', [{ name: 'readPage', input: {}, output: 'PAGE' }]);
    expect(t).toContain('GOAL');
    expect(t).toContain('hello');
    expect(t).toContain('NOT done until the GOAL');
    expect(t).toContain('> readPage({})');
    expect(t).toContain('< PAGE');
  });
  it('describeAgentAction renders a compact one-liner and truncates huge inputs', () => {
    expect(describeAgentAction('click', { selector: '#buy' })).toBe('click({"selector":"#buy"})');
    expect(describeAgentAction('type', { v: 'x'.repeat(500) }).length).toBeLessThanOrEqual(170 + 'type()'.length);
  });
  it('looksLikeActionIntent flags a "Let me…" preamble but not a real final answer', () => {
    expect(looksLikeActionIntent('Let me navigate to your LinkedIn profile to review it.')).toBe(true);
    expect(looksLikeActionIntent("I'll click the submit button now.")).toBe(true);
    expect(looksLikeActionIntent('Your profile looks strong — clear headline and a good photo.')).toBe(false);
    expect(looksLikeActionIntent('Done. Let me know if you want me to review a specific section.')).toBe(false);
    expect(looksLikeActionIntent('Here is my detailed review of the page. '.repeat(40))).toBe(false); // too long = a real answer
  });

  it('looksLikeActionIntent catches German narration (the panel is multilingual)', () => {
    // The exact failure from the field: glm-5.2 narrated a job search in German and stopped,
    // never calling a tool — the English-only matcher accepted it as a final answer.
    expect(looksLikeActionIntent(
      'Ich suche auf LinkedIn Jobs nach passenden Stellen für dich. Basierend auf deinem Profil starte ich mit einer gezielten Suche.',
    )).toBe(true);
    expect(looksLikeActionIntent('Ich navigiere jetzt zu deinem Profil und lese die Seite.')).toBe(true);
    expect(looksLikeActionIntent('Ich öffne die Stellenseite und tippe deine Suchbegriffe ein.')).toBe(true); // umlaut-initial verb must match
  });

  it('looksLikeActionIntent does NOT nudge a German/English FINAL answer (advice, not action)', () => {
    expect(looksLikeActionIntent('Dein Profil sieht stark aus — klare Überschrift und ein gutes Foto.')).toBe(false);
    // "ich finde X gut" = opinion, not self-action; bare "jetzt" must not trigger.
    expect(looksLikeActionIntent('Jetzt sieht dein Profil besser aus und ich finde den Abschnitt hilfreich.')).toBe(false);
    // "such"/"enter" as ordinary English words must not be read as verbs.
    expect(looksLikeActionIntent('This is such a strong profile; no changes needed.')).toBe(false);
    expect(looksLikeActionIntent('That headline is entertainment-industry specific and reads well.')).toBe(false);
  });

  it('looksLikeDeferral flags "how would you like me to proceed" but not a completed answer', () => {
    // The field stall (Image #7): it read the page then asked the user to drive.
    expect(looksLikeDeferral('How would you like me to proceed? Here are some options I can help with: 1. Open a specific job …')).toBe(true);
    expect(looksLikeDeferral('Just let me know which one you’d like to do.')).toBe(true);
    expect(looksLikeDeferral('Would you like me to open the NVIDIA role or refine the search?')).toBe(true);
    expect(looksLikeDeferral('Soll ich die Stelle bei NVIDIA öffnen?')).toBe(true);
    // A genuinely COMPLETE answer (offers more but didn't stall) must NOT be flagged.
    expect(looksLikeDeferral('I found 5 roles that fit: NVIDIA, AWS, Ashby … Let me know if you want details on any.')).toBe(false);
    expect(looksLikeDeferral('Here are the matching jobs, ranked by fit. The AWS role is the strongest match.')).toBe(false);
  });
});

describe('AgenticTurnBrainClient — the ReAct loop', () => {
  it('no tool call → streams the engine answer and responds', async () => {
    const client = makeAgent(['Just answering directly.']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
    expect(events.some((e) => e.kind === 'capability-request')).toBe(false);
    expect(events.find((e) => e.kind === 'engine')).toMatchObject({ engineId: 'claude', content: 'Just answering directly.' });
    expect(result).toMatchObject({ responded: true, engineId: 'claude' });
  });

  it('a read-only tool runs WITHOUT approval: capability-request → result → final answer', async () => {
    const client = makeAgent([`${MARK} {"name":"readPage","input":{}}`, 'The page is the Agon docs.']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });

    let capInput: unknown;
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: (ev) => { capInput = (ev as { capability: string }).capability; return { ok: true, output: '<page text>' }; },
      approval: () => 'approve',
    });
    expect(events.some((e) => e.kind === 'approval-request')).toBe(false); // read-only is never gated
    expect(events.find((e) => e.kind === 'capability-request')).toMatchObject({ capability: 'readPage', targetClientId: 'c' });
    expect(capInput).toBe('readPage');
    expect(events.filter((e) => e.kind === 'tool').length).toBeGreaterThanOrEqual(2); // running + done
    expect(events.find((e) => e.kind === 'engine')).toMatchObject({ content: 'The page is the Agon docs.' });
    expect(result.responded).toBe(true);
  });

  it('a destructive tool GATES on approval before the capability-request', async () => {
    const client = makeAgent([`${MARK} {"name":"click","input":{"selector":"#buy"}}`, 'Clicked it.']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec() });

    let approvalCmd: string | undefined;
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: () => ({ ok: true, output: 'done' }),
      approval: (ev) => { approvalCmd = (ev as { command: string }).command; return 'approve'; },
    });
    const ai = events.findIndex((e) => e.kind === 'approval-request');
    const ci = events.findIndex((e) => e.kind === 'capability-request');
    expect(ai).toBeGreaterThanOrEqual(0);
    expect(ci).toBeGreaterThan(ai); // approval precedes execution
    expect(approvalCmd).toContain('click');
    expect(result.responded).toBe(true);
  });

  it('a DENIED destructive tool never executes; the engine is told and can still answer', async () => {
    const client = makeAgent([`${MARK} {"name":"click","input":{"selector":"#buy"}}`, 'OK, I will not click it.']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'deny' });
    expect(events.some((e) => e.kind === 'capability-request')).toBe(false); // never ran
    expect(result.responded).toBe(true);
  });

  it("'abort' at an approval prompt ends the turn", async () => {
    const client = makeAgent([`${MARK} {"name":"click","input":{}}`, 'unused']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'abort' });
    expect(events.some((e) => e.kind === 'capability-request')).toBe(false);
    expect(result.responded).toBe(false);
    expect(result.reason).toMatch(/abort/i);
  });

  it("'approve-session' suppresses the approval prompt on the next use of the same tool", async () => {
    const client = makeAgent([`${MARK} {"name":"click","input":{"selector":"#a"}}`, `${MARK} {"name":"click","input":{"selector":"#b"}}`, 'Both done.']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec() });
    let approvals = 0;
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: () => ({ ok: true, output: 'ok' }),
      approval: () => { approvals++; return 'approve-session'; },
    });
    expect(approvals).toBe(1); // the second click is NOT gated again
    expect(events.filter((e) => e.kind === 'capability-request').length).toBe(2);
    expect(result.responded).toBe(true);
  });

  it('FAIL-SAFE gate: a tool that is not explicitly read-only is gated even without isDestructive', async () => {
    const client = makeAgent([`${MARK} {"name":"mutate","input":{}}`, 'did it']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    // Neither isReadOnly:true nor isDestructive:true — a mis-/under-declared mutating tool.
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: { name: 'mutate', description: 'changes things', inputSchema: {}, isReadOnly: false } });
    let approvalAsked = false;
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: () => ({ ok: true, output: 'ok' }),
      approval: () => { approvalAsked = true; return 'approve'; },
    });
    expect(approvalAsked).toBe(true); // gated despite isDestructive omitted (default-deny)
    expect(events.some((e) => e.kind === 'approval-request')).toBe(true);
    expect(result.responded).toBe(true);
  });

  it('nudges an engine that narrates an action without a tool call, then it acts', async () => {
    const client = makeAgent([
      'Let me navigate to your profile to review it.', // narration, no tool → nudge
      `${MARK} {"name":"readPage","input":{}}`,         // now it actually acts
      'Your profile looks good.',                       // final answer
    ]);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: () => ({ ok: true, output: 'PAGE' }),
      approval: () => 'approve',
    });
    expect(events.some((e) => e.kind === 'notice' && /tool call/.test((e as { message: string }).message))).toBe(true);
    expect(events.some((e) => e.kind === 'capability-request')).toBe(true);
    expect(result.responded).toBe(true);
  });

  it('drives a multi-site browse from a GERMAN narration: nudge → navigate → read → navigate → read → answer', async () => {
    // The field scenario: the brain narrates a job search in German, then (once nudged) actually
    // switches sites and reads each. Proves the loop does autonomous multi-step browsing — open a
    // site, check it, open another, check it — not just a single read.
    const navSpec: CapabilitySpec = { name: 'navigate', description: 'navigate the tab to a url', inputSchema: { url: 'string' }, isReadOnly: false, isDestructive: true };
    const client = makeAgent([
      'Ich öffne zuerst die LinkedIn-Jobs-Seite und suche passende Stellen für dich.', // German narration, no tool → nudge
      `${MARK} {"name":"navigate","input":{"url":"https://www.linkedin.com/jobs/"}}`,   // switch to site 1
      `${MARK} {"name":"readPage","input":{}}`,                                          // check site 1
      `${MARK} {"name":"navigate","input":{"url":"https://www.linkedin.com/jobs/view/42"}}`, // switch to site 2
      `${MARK} {"name":"readPage","input":{}}`,                                          // check site 2
      'Ich habe zwei passende Stellen gefunden, die zu AI Tooling und React passen.',    // final answer
    ]);
    await client.open({ sessionId: 's', engineId: 'zai-coding-plan-glm-5.2', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: navSpec });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });

    let approvals = 0;
    const { events, result } = await driveAgent(client, client.runTurn(req('t1', 'kannst du mir gute jobs suchen')), {
      capability: () => ({ ok: true, output: 'PAGE CONTENT' }),
      approval: () => { approvals++; return 'approve-session'; }, // approve navigate once, for the session
    });

    const caps = events.filter((e) => e.kind === 'capability-request');
    expect(events.some((e) => e.kind === 'notice' && /tool call/.test((e as { message: string }).message))).toBe(true); // German narration WAS nudged
    expect(caps.length).toBe(4);   // navigate, readPage, navigate, readPage — it switched sites twice and checked each
    expect(approvals).toBe(1);     // the 2nd navigate isn't re-gated (approve-session)
    expect(result.responded).toBe(true);
  });

  it('gives up nudging after the retry budget and returns the prose (no infinite loop)', async () => {
    const client = makeAgent(['Let me click the button.']); // always narrates, never emits a tool
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
    const nudges = events.filter((e) => e.kind === 'notice' && /actually act|decide and continue/.test((e as { message: string }).message)).length;
    expect(nudges).toBe(3); // MAX_NARRATION_RETRIES — bounded (consecutive, no progress to reset it)
    expect(events.find((e) => e.kind === 'engine')).toMatchObject({ content: 'Let me click the button.' });
    expect(result.responded).toBe(true);
  });

  it('resets the narration budget on progress: narrate→act→narrate→act→narrate→act→answer completes', async () => {
    // The minimax field bug: it made real progress (navigate/screenshot/click) but the budget was
    // CUMULATIVE, so a later narration killed the turn mid-task. With reset-on-progress, three
    // narrations spread across a progressing turn each get nudged and the turn still COMPLETES.
    const client = makeAgent([
      'I will read the listings.',                                  // narrate → nudge (consecutive=1)
      `${MARK} {"name":"navigate","input":{"url":"https://a.com"}}`, // DISTINCT act → reset budget
      'Let me check the next site.',                                // narrate → nudge (consecutive=1 again)
      `${MARK} {"name":"navigate","input":{"url":"https://b.com"}}`, // distinct act → reset
      "I'll review the third option.",                              // narrate → nudge (consecutive=1)
      `${MARK} {"name":"navigate","input":{"url":"https://c.com"}}`, // distinct act → reset
      'Here is my final summary.',                                  // final answer (NOT a narration)
    ]);
    await client.open({ sessionId: 's', engineId: 'minimax-coding-plan-minimax-m3', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: { name: 'navigate', description: 'go', inputSchema: { url: 'string' }, isReadOnly: false, isDestructive: true } });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true, output: 'PAGE' }), approval: () => 'approve-session' });
    const nudges = events.filter((e) => e.kind === 'notice' && /actually act/.test((e as { message: string }).message)).length;
    expect(nudges).toBe(3);          // each narration nudged — the budget reset after every tool call
    expect(result.responded).toBe(true);
    expect(events.find((e) => e.kind === 'engine')).toMatchObject({ content: 'Here is my final summary.' }); // completed, NOT killed on a narration
  });

  it('a DEFERRAL ("how would you like me to proceed?") now ASKS the user, then continues with their answer', async () => {
    // The "not agentic at all" failure (Image #7): it read the page then asked the user to drive.
    // New behavior: that question is surfaced to the user (question-request), answered, and the turn
    // continues — the human-in-the-loop "ask + approve" flow, instead of a force-nudge.
    const client = makeAgent([
      'I can see the LinkedIn jobs page. How would you like me to proceed? 1. Open a job 2. Refine 3. Try another query.', // deferral → ask
      `${MARK} {"name":"readPage","input":{}}`,        // acts on the answer
      'I found 3 roles that fit your AI-tooling + frontend-lead profile: …',  // final RESULT
    ]);
    await client.open({ sessionId: 's', engineId: 'zai-coding-plan-glm-5.2', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1', 'find me cool jobs')), { capability: () => ({ ok: true, output: 'JOBS' }), approval: () => 'approve', question: () => 'option 1 — open the best-fit job' });
    expect(events.some((e) => e.kind === 'question-request')).toBe(true); // the deferral was surfaced to the user
    expect(events.some((e) => e.kind === 'capability-request')).toBe(true); // it then actually acted
    expect(result.responded).toBe(true);
    expect(events.find((e) => e.kind === 'engine')).toMatchObject({ content: expect.stringContaining('3 roles that fit') });
  });

  it('still NUDGES pure NARRATION (described an action, no question) to actually emit the tool line', async () => {
    // Narration ≠ a question — there is nothing to ask the user, so it keeps the autonomous nudge.
    const client = makeAgent([
      'Let me read the page to find the jobs.',          // narration (action intent), no tool → nudge
      `${MARK} {"name":"readPage","input":{}}`,           // then it acts
      'Here are the roles I found.',                      // final answer
    ]);
    await client.open({ sessionId: 's', engineId: 'zai-coding-plan-glm-5.2', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true, output: 'JOBS' }), approval: () => 'approve' });
    expect(events.some((e) => e.kind === 'question-request')).toBe(false); // narration is NOT a question
    expect(events.some((e) => e.kind === 'notice' && /actually act/.test((e as { message: string }).message))).toBe(true); // it was nudged
    expect(result.responded).toBe(true);
  });

  it('detects an identical-action LOOP: blocks the repeat (no re-approval) and stops if it persists', async () => {
    // The double-approval bug (Image #5): the engine re-emits the SAME click. The loop must NOT
    // re-run it (so the user isn't re-prompted for the same approval), and must give up if it
    // keeps looping — termination by no-progress, not by a step count.
    const sameClick = `${MARK} {"name":"click","input":{"selector":"a[href*='/jobs/view/']"}}`;
    const client = makeAgent([sameClick, sameClick, sameClick, sameClick]);
    await client.open({ sessionId: 's', engineId: 'zai-coding-plan-glm-5.2', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec() });
    let approvals = 0;
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: () => ({ ok: true, output: 'clicked' }),
      approval: () => { approvals++; return 'approve'; },
    });
    expect(approvals).toBe(1); // only the FIRST click prompted; the identical repeats were blocked, not re-approved
    expect(events.filter((e) => e.kind === 'capability-request').length).toBe(1); // only the first actually executed
    expect(result.responded).toBe(false);
    expect(result.reason).toMatch(/stuck|repeated/);
  });

  it('a DISTINCT repeat of the same tool (different input) is progress, not a loop', async () => {
    const client = makeAgent([
      `${MARK} {"name":"navigate","input":{"url":"https://a.com"}}`,
      `${MARK} {"name":"navigate","input":{"url":"https://b.com"}}`, // same tool, different url → NOT a loop
      'Visited both.',
    ]);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: { name: 'navigate', description: 'go', inputSchema: { url: 'string' }, isReadOnly: false, isDestructive: true } });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true, output: 'ok' }), approval: () => 'approve-session' });
    expect(events.filter((e) => e.kind === 'capability-request').length).toBe(2); // both navigations ran
    expect(result.responded).toBe(true);
  });

  it('re-view detector: an identical read-only result (after another tool) is flagged NO CHANGE', async () => {
    // The flail: readPage, a different read-only tool, then readPage AGAIN returning the SAME view.
    // The two readPages are not CONSECUTIVE (so the repeat detector stays quiet), but the second is
    // identical content → it must carry the NO-CHANGE feedback that pushes a scroll/act. One re-view
    // alone (noProgress 1 < budget) does NOT stop the turn — it reaches the final answer.
    const client = makeAgent([
      `${MARK} {"name":"readPage","input":{}}`,
      `${MARK} {"name":"inspect","input":{}}`,
      `${MARK} {"name":"readPage","input":{}}`,
      'Final answer.',
    ]);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec('readPage') });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec('inspect') });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: (ev) => ({ ok: true, output: (ev as unknown as { capability: string }).capability === 'readPage' ? 'SAME VIEW' : `fresh-${(ev as unknown as { requestId: string }).requestId}` }),
      approval: () => 'approve',
    });
    const reads = events.filter((e) => e.kind === 'tool' && (e as unknown as { tool: string; status: string }).tool === 'readPage' && (e as unknown as { status: string }).status === 'done') as unknown as Array<{ output: string }>;
    expect(reads.length).toBe(2);
    expect(reads[0].output).not.toMatch(/NO CHANGE/);   // first read is fresh
    expect(reads[1].output).toMatch(/NO CHANGE/);         // identical re-view is flagged
    expect(result.responded).toBe(true);
  });

  it('B (selection recovery): a click that MISSES re-grounds once — the brain auto-readPages, then the retry lands', async () => {
    // A weaker engine emits a Playwright `:has-text()` selector the page can't resolve. Instead of
    // leaving it to blind-retry, the brain reads the page ITSELF (a readPage the engine never asked
    // for) and hands back the real `sel=` selectors, so the next click succeeds.
    const client = makeAgent([
      `${MARK} {"name":"click","input":{"selector":"button:has-text(\\"Comment\\")"}}`, // miss
      `${MARK} {"name":"click","input":{"selector":"#real-comment-btn"}}`,              // retry with a valid selector
      'Posted the comment.',
    ]);
    await client.open({ sessionId: 's', engineId: 'minimax-coding-plan-minimax-m3', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec('readPage') });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec('click') });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: (ev) => {
        const e = ev as unknown as { capability: string; input?: { selector?: string } };
        if (e.capability === 'readPage') return { ok: true, output: 'INTERACTIVE: [button] "Comment" sel=#real-comment-btn' };
        const selector = e.input?.selector ?? '';
        if (selector.indexOf('has-text') !== -1) return { ok: false, error: `no element matches "${selector}"` };
        return { ok: true, output: 'clicked' };
      },
      approval: () => 'approve-session', // approve the click for the session so the retry isn't gated again
    });
    const caps = events.filter((e) => e.kind === 'capability-request').map((e) => (e as unknown as { capability: string }).capability);
    expect(caps).toEqual(['click', 'readPage', 'click']); // the engine asked for 2 clicks; the brain INSERTED a readPage between them
    expect(result.responded).toBe(true);
  });

  it('B (selection recovery): the re-ground is ONE-SHOT — repeated misses do not re-read every time', async () => {
    // If the engine keeps missing even after being handed the real selectors, we must NOT readPage on
    // every failure (that would spam the page). One re-ground per miss; the failure streak caps the rest.
    const client = makeAgent([
      `${MARK} {"name":"click","input":{"selector":"button:has-text(\\"A\\")"}}`,
      `${MARK} {"name":"click","input":{"selector":"button:has-text(\\"B\\")"}}`,
      `${MARK} {"name":"click","input":{"selector":"button:has-text(\\"C\\")"}}`,
      'I could not find it.',
    ]);
    await client.open({ sessionId: 's', engineId: 'codex', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec('readPage') });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec('click') });
    const { events } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: (ev) => {
        const e = ev as unknown as { capability: string };
        if (e.capability === 'readPage') return { ok: true, output: 'INTERACTIVE: (no matching buttons)' };
        return { ok: false, error: 'no element matches' };
      },
      approval: () => 'approve-session',
    });
    const reads = events.filter((e) => e.kind === 'capability-request' && (e as unknown as { capability: string }).capability === 'readPage');
    expect(reads.length).toBe(1); // re-grounded ONCE on the first miss, not after every consecutive miss
  });

  it('re-view detector STOPS the turn when the agent keeps re-viewing the same screens (no progress)', async () => {
    // Both read-only tools return CONSTANT output → every read after the first is a re-view. With
    // nothing ever changing and no action taken, noProgress climbs past the budget and the turn
    // stops as STUCK instead of spinning to the 30-step backstop (the screenshot↔readPage flail).
    const r = (n: string) => `${MARK} {"name":"${n}","input":{}}`;
    const client = makeAgent([r('readPage'), r('inspect'), r('readPage'), r('inspect'), r('readPage'), r('inspect'), r('readPage')]);
    await client.open({ sessionId: 's', engineId: 'zai-coding-plan-glm-5.2', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec('readPage') });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec('inspect') });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: (ev) => ({ ok: true, output: (ev as unknown as { capability: string }).capability === 'readPage' ? 'PAGE' : 'INSP' }),
      approval: () => 'approve',
    });
    expect(result.responded).toBe(false);
    expect(result.reason).toMatch(/stuck|re-?view|same/i);
    // It stopped WELL short of the 30-step backstop (a handful of re-views, not 30).
    expect(events.filter((e) => e.kind === 'capability-request').length).toBeLessThan(10);
  });

  it('STOPS the turn after consecutive FAILING tool calls (the varying-bad-args flail the loop guard misses)', async () => {
    // The model navigates with a DIFFERENT bad input each step, so every callKey differs → the
    // identical-repeat guard never trips, and a failed action is progress-NEUTRAL → the no-progress
    // guard never trips either. Without the failure guard this would flail to the 30-step backstop
    // (the real navigate→"invalid url" loop). The consecutive-failure cap ends it early.
    const nav = (u: string) => `${MARK} {"name":"navigate","input":{"url":"${u}"}}`;
    const navSpec: CapabilitySpec = { name: 'navigate', description: 'go to a url', inputSchema: { url: 'string' }, isReadOnly: false, isDestructive: true };
    const client = makeAgent([nav('bad1'), nav('bad2'), nav('bad3'), nav('bad4'), nav('bad5'), nav('bad6')]);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: navSpec });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: () => ({ ok: false, error: 'invalid url' }),
      approval: () => 'approve-session', // approve once so later navigates skip the gate and we exercise pure failures
    });
    expect(result.responded).toBe(false);
    expect(result.reason).toMatch(/in a row failed|malformed/i);
    expect(result.reason).toContain('invalid url'); // the last error is surfaced
    // Stopped at the failure cap (MAX_CONSECUTIVE_TOOL_FAILURES=4), nowhere near the 30-step backstop.
    expect(events.filter((e) => e.kind === 'capability-request').length).toBe(4);
  });

  it('DEFERRAL → asks the user mid-turn, then CONTINUES the same turn with their answer', async () => {
    // The engine poses a question instead of acting. Instead of dead-ending or being force-nudged,
    // the brain surfaces a question-request, pauses for the user's answer, injects it, and continues
    // — so the click runs AFTER the answer and the turn finishes (the user's "ask + approve" flow).
    const client = makeAgent([
      'Would you like me to proceed with posting /kern wrong on all 18 comments?', // deferral → ask
      `${MARK} {"name":"click","input":{"selector":"#reply"}}`,                      // acts after the answer
      'Posted /kern wrong on every kern-guard thread.',                              // final answer
    ]);
    await client.open({ sessionId: 's', engineId: 'minimax-coding-plan-minimax-m3', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: () => ({ ok: true }),
      approval: () => 'approve',
      question: () => 'yes, post /kern wrong on all of them',
    });
    const q = events.find((e) => e.kind === 'question-request') as { prompt?: string } | undefined;
    expect(q).toBeTruthy();
    expect(q?.prompt).toContain('/kern wrong'); // the engine's question is surfaced verbatim
    expect(events.some((e) => e.kind === 'capability-request' && (e as unknown as { capability: string }).capability === 'click')).toBe(true); // acted AFTER answering
    expect(result.responded).toBe(true); // continued to a real answer, not a dead-end
  });

  it('an unanswered/timed-out-equivalent abort during a question ends the turn cleanly (no hang)', async () => {
    // Drive the turn but ABORT instead of answering the question → the turn returns cancelled.
    const client = makeAgent(['Do you want me to proceed?', 'unused']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec() });
    const gen = client.runTurn(req('t1'));
    const events: BrainEvent[] = [];
    let r = await gen.next();
    while (!r.done) {
      events.push(r.value);
      if (r.value.kind === 'question-request') { void client.cancel({ sessionId: 's', turnId: 't1', clientId: 'c' }); }
      r = await gen.next();
    }
    expect(events.some((e) => e.kind === 'question-request')).toBe(true);
    expect(r.value.responded).toBe(false);
    expect(r.value.reason).toMatch(/cancel/i);
  });

  it('provideAnswer rejects a stale requestId; questionArbitration is host-only', async () => {
    const client = makeAgent(['x']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    expect((await client.provideAnswer({ sessionId: 's', requestId: 'nope', clientId: 'c', answer: 'hi' })).status).toBe('rejected');
    expect((client as unknown as { controlCapabilities: { questionArbitration: string } }).controlCapabilities.questionArbitration).toBe('host-only');
  });

  it('provideAnswer enforces HOST-ONLY: a wrong-client answer to a LIVE question is rejected; the submitter is accepted', async () => {
    // Set up a real pending question (a deferred turn), then prove a non-submitter cannot answer it
    // (the fail-safe clientId check) while the turn's submitter ('c') can — and the turn continues.
    const client = makeAgent(['Would you like me to proceed?', `${MARK} {"name":"readPage","input":{}}`, 'done']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    const gen = client.runTurn(req('t1')); // req() submits with clientId 'c'
    let qid = '';
    let r = await gen.next();
    while (!r.done) {
      if (r.value.kind === 'question-request') {
        qid = (r.value as { requestId: string }).requestId;
        // a DIFFERENT client must NOT be able to answer (no falsy short-circuit accepting it)
        expect((await client.provideAnswer({ sessionId: 's', requestId: qid, clientId: 'intruder', answer: 'no' })).status).toBe('rejected');
        // the submitter answers → accepted, un-pausing the turn
        queueMicrotask(() => { void client.provideAnswer({ sessionId: 's', requestId: qid, clientId: 'c', answer: 'yes, proceed' }); });
      } else if (r.value.kind === 'capability-request') {
        const reqId = (r.value as { requestId: string }).requestId;
        queueMicrotask(() => { void client.provideCapabilityResult({ sessionId: 's', requestId: reqId, clientId: 'c', ok: true, output: 'PAGE' }); });
      }
      r = await gen.next();
    }
    expect(qid).toBeTruthy();
    expect(r.value.responded).toBe(true); // the submitter's answer let it continue to a real result
  });

  it('an unknown tool is reported back and the loop recovers to an answer', async () => {
    const client = makeAgent([`${MARK} {"name":"teleport","input":{}}`, 'I cannot do that here.']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    // no capability registered
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
    expect(events.some((e) => e.kind === 'capability-request')).toBe(false);
    expect(result.responded).toBe(true);
  });

  it('the step backstop bounds an engine that keeps making DISTINCT tool calls without ever finishing', async () => {
    // No identical repeat (so the loop detector doesn't fire) and no final answer → only the
    // MAX_AGENT_STEPS safety backstop ends it. Proves the backstop still bounds a runaway turn,
    // and that the turn now runs well past the old 8-step ceiling (it's goal/progress-driven).
    let n = 0;
    const registry = { get: (id: string) => ({ id }), listIds: () => ['claude'] } as unknown as EngineRegistry;
    const client = new AgenticTurnBrainClient(registry);
    (client as unknown as { adapter: EngineAdapter }).adapter = {
      dispatch: async () => ({ exitCode: 0, stdout: `${MARK} {"name":"navigate","input":{"url":"https://site-${n++}.com"}}`, stderr: '', durationMs: 1, timedOut: false }),
      isAvailable: async () => true,
    } as unknown as EngineAdapter;
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: { name: 'navigate', description: 'go', inputSchema: { url: 'string' }, isReadOnly: false, isDestructive: true } });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true, output: 'ok' }), approval: () => 'approve-session' });
    expect(result.responded).toBe(false);
    expect(result.reason).toMatch(/backstop|step/i);
    expect(events.filter((e) => e.kind === 'capability-request').length).toBeGreaterThan(8); // ran past the old 8-step cap
  });
});

describe('AgenticTurnBrainClient — control surface', () => {
  it('declares clientCapabilities supported + host-only approvals + host-only questions + per-turn cancel', () => {
    const client = makeAgent(['x']);
    expect(client.controlCapabilities).toEqual({
      concurrentTurns: 'per-session-serialized',
      concurrentSteering: 'unsupported',
      approvalArbitration: 'host-only',
      questionArbitration: 'host-only', // mid-turn ask-the-user channel is now implemented
      clientCapabilities: 'supported',
      cancellation: 'per-turn',
    });
  });

  it('register + provide acks: a stale requestId is rejected, not unsupported', async () => {
    const client = makeAgent(['x']);
    expect(await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() })).toEqual({ status: 'accepted' });
    expect((await client.provideCapabilityResult({ sessionId: 's', requestId: 'nope', clientId: 'c', ok: true })).status).toBe('rejected');
    expect((await client.provideApproval({ sessionId: 's', requestId: 'nope', clientId: 'c', decision: 'approve' })).status).toBe('rejected');
  });

  it('notifyClientDetached drops that client’s capabilities (no phantom tools)', async () => {
    const client = makeAgent([`${MARK} {"name":"readPage","input":{}}`, 'answered without the tool']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c1', spec: readSpec() });
    client.notifyClientDetached('s', 'c1'); // panel closed
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
    expect(events.some((e) => e.kind === 'capability-request')).toBe(false); // tool is gone → treated as unknown
    expect(result.responded).toBe(true);
  });

  it('cancel mid-turn (while awaiting a tool result) ends the turn as cancelled', async () => {
    const client = makeAgent([`${MARK} {"name":"readPage","input":{}}`, 'unused']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    const gen = client.runTurn(req('t1'));
    // Drain until the capability-request is yielded (the loop then awaits the result).
    const events: BrainEvent[] = [];
    let r = await gen.next();
    while (!r.done && r.value.kind !== 'capability-request') { events.push(r.value); r = await gen.next(); }
    expect(r.done).toBe(false); // we paused on the capability-request
    // Don't answer it — cancel instead.
    expect(await client.cancel({ sessionId: 's', turnId: 't1', clientId: 'c' })).toEqual({ status: 'accepted' });
    let fin = await gen.next();
    while (!fin.done) fin = await gen.next();
    expect((fin.value as BrainTurnResult).responded).toBe(false);
    expect((fin.value as BrainTurnResult).reason).toBe('cancelled by client');
  });

  it('ownership: a capability result from a non-owner client is rejected; the owner is accepted', async () => {
    const client = makeAgent([`${MARK} {"name":"readPage","input":{}}`, 'done reading']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'owner', spec: readSpec() });
    const gen = client.runTurn({ sessionId: 's', turnId: 't1', clientId: 'owner', input: 'read it' });
    let attackerAck = '';
    let ownerAck = '';
    let r = await gen.next();
    while (!r.done) {
      if (r.value.kind === 'capability-request') {
        const reqId = (r.value as { requestId: string }).requestId;
        queueMicrotask(async () => {
          // A second token-holding client (different clientId) cannot answer the request…
          attackerAck = (await client.provideCapabilityResult({ sessionId: 's', requestId: reqId, clientId: 'attacker', ok: true, output: 'X' })).status;
          // …but the owner can, and the turn then completes.
          ownerAck = (await client.provideCapabilityResult({ sessionId: 's', requestId: reqId, clientId: 'owner', ok: true, output: 'PAGE' })).status;
        });
      }
      r = await gen.next();
    }
    expect(attackerAck).toBe('rejected');
    expect(ownerAck).toBe('accepted');
    expect((r.value as BrainTurnResult).responded).toBe(true);
  });

  it('factory builds an interface-conformant agent reporting liveness', async () => {
    const client = createAgenticTurnBrainClient({ get: (id: string) => ({ id }), listIds: () => ['claude'] } as unknown as EngineRegistry);
    const h = await client.health();
    expect(h.alive).toBe(true);
    expect(h.activeTurnId).toBeNull();
  });
});

// ── Native function-calling transport ────────────────────────────────────────
// API-capable engines (the coding-plan models) emit a STRUCTURED tool_call part
// instead of typing the __AGON_TOOL__ text marker — the durable fix for the
// narrate-and-stop / marker-forgetting failure. The loop must be transport-agnostic.

// A step is either scripted stdout (text-marker / CLI engines) or a native step
// carrying DispatchResult.parts (API engines). The adapter echoes a <tool> marker
// into stdout for a native call (matching apiStreamDispatchWithHistory), so the
// empty-stdout guard never misfires. Captures every dispatch options object.
type NativePart = { kind: string; toolName?: string; toolCallId?: string; args?: Record<string, unknown>; text?: string };
type Step = string | { parts: NativePart[]; stdout?: string };
type CapturedDispatch = {
  tools?: Array<{ type: string; function: { name: string } }>;
  messages?: Array<{ role: string; content: unknown; tool_calls?: Array<{ id: string }> }>;
  systemPrompt?: string;
};
// engineFor lets a test shape the resolved engine (e.g. give it an `api` block and no `binary` so the
// brain treats it as a NATIVE function-calling engine, or a `binary` so it stays a text-marker engine).
function makeAgentSteps(steps: Step[], engineFor?: (id: string) => Record<string, unknown>): { client: AgenticTurnBrainClient; dispatches: CapturedDispatch[] } {
  let i = 0;
  const dispatches: CapturedDispatch[] = [];
  const registry = {
    get: (id: string) => (engineFor ? engineFor(id) : { id }),
    listIds: () => ['claude', 'codex'],
    // Mirror the adapter's binary resolution: a declared binary resolves to a usable path (→ CLI path),
    // a missing/undeclared one is null (→ API path). Lets a test toggle native vs marker by engine shape.
    findBinary: (e: { binary?: string }) => (e && e.binary ? `/usr/bin/${e.binary}` : null),
  } as unknown as EngineRegistry;
  const client = new AgenticTurnBrainClient(registry);
  (client as unknown as { adapter: EngineAdapter }).adapter = {
    dispatch: async (opts: CapturedDispatch) => {
      dispatches.push(opts);
      const step = steps[Math.min(i++, steps.length - 1)];
      if (typeof step === 'string') return { exitCode: 0, stdout: step, stderr: '', durationMs: 1, timedOut: false };
      const echo = step.stdout ?? (step.parts
        .filter((p) => p.kind === 'tool_call')
        .map((p) => `\n<tool name="${p.toolName}">${JSON.stringify(p.args ?? {})}</tool>\n`)
        .join('') || 'ok');
      return { exitCode: 0, stdout: echo, stderr: '', durationMs: 1, timedOut: false, parts: step.parts };
    },
    isAvailable: async () => true,
  } as unknown as EngineAdapter;
  return { client, dispatches };
}

describe('extractNativeToolCall — structured tool_call parts', () => {
  it('returns the first tool_call part as {name,input}', () => {
    expect(extractNativeToolCall([
      { kind: 'reasoning', text: 'thinking' },
      { kind: 'tool_call', toolName: 'click', toolCallId: 't1', args: { selector: '#buy' } },
    ])).toEqual({ name: 'click', input: { selector: '#buy' } });
  });
  it('skips text/reasoning parts and finds a later tool_call', () => {
    expect(extractNativeToolCall([
      { kind: 'text', text: 'Let me click.' },
      { kind: 'tool_call', toolName: 'readPage', toolCallId: 't2', args: {} },
    ])).toEqual({ name: 'readPage', input: {} });
  });
  it('defaults a missing/non-object args to {}', () => {
    expect(extractNativeToolCall([{ kind: 'tool_call', toolName: 'readPage', toolCallId: 't3' }]))
      .toEqual({ name: 'readPage', input: {} });
  });
  it('returns null for prose-only parts (no tool_call) and for undefined/empty', () => {
    expect(extractNativeToolCall([{ kind: 'text', text: 'final answer' }])).toBeNull();
    expect(extractNativeToolCall(undefined)).toBeNull();
    expect(extractNativeToolCall([])).toBeNull();
  });
});

describe('unwrapToolInputEnvelope — strips a redundant {input:…} envelope the model double-wraps', () => {
  it('unwraps navigate({input:{url}}) → navigate({url}) (the live "invalid url" flail)', () => {
    expect(unwrapToolInputEnvelope({ name: 'navigate', input: { input: { url: 'https://example.com' } } }))
      .toEqual({ name: 'navigate', input: { url: 'https://example.com' } });
  });
  it('unwraps click({input:{selector}}) → click({selector}) (the live "needs a string selector" flail)', () => {
    expect(unwrapToolInputEnvelope({ name: 'click', input: { input: { selector: 'a[href="/x"]' } } }))
      .toEqual({ name: 'click', input: { selector: 'a[href="/x"]' } });
  });
  it('leaves a normal call untouched (sole/other key is a real field, not "input")', () => {
    expect(unwrapToolInputEnvelope({ name: 'navigate', input: { url: 'https://example.com' } }))
      .toEqual({ name: 'navigate', input: { url: 'https://example.com' } });
    expect(unwrapToolInputEnvelope({ name: 'type', input: { selector: '#a', text: 'hi' } }))
      .toEqual({ name: 'type', input: { selector: '#a', text: 'hi' } });
    expect(unwrapToolInputEnvelope({ name: 'readPage', input: {} }))
      .toEqual({ name: 'readPage', input: {} });
  });
  it('does NOT unwrap when "input" is not the sole key (a real multi-field call is preserved)', () => {
    // selector + input both present → not a pure envelope; keep as-is so no real field is dropped.
    expect(unwrapToolInputEnvelope({ name: 'type', input: { selector: '#a', input: 'x' } }))
      .toEqual({ name: 'type', input: { selector: '#a', input: 'x' } });
  });
  it('does NOT unwrap a string-valued input key (would break the object contract)', () => {
    expect(unwrapToolInputEnvelope({ name: 'navigate', input: { input: 'https://example.com' } }))
      .toEqual({ name: 'navigate', input: { input: 'https://example.com' } });
  });
  it('resolves a deeper (bounded) multi-wrap and passes null through', () => {
    expect(unwrapToolInputEnvelope({ name: 'navigate', input: { input: { input: { url: 'u' } } } }))
      .toEqual({ name: 'navigate', input: { url: 'u' } });
    expect(unwrapToolInputEnvelope(null)).toBeNull();
  });
  it('does NOT strip a tool that LEGITIMATELY declares an `input` arg (knownFields guard)', () => {
    // A hypothetical future tool whose real sole arg is named `input` must survive verbatim.
    const call = { name: 'runQuery', input: { input: { sql: 'select 1' } } };
    expect(unwrapToolInputEnvelope(call, ['input'])).toEqual(call); // protected
    expect(unwrapToolInputEnvelope(call, ['url'])) // a tool that does NOT take `input` → still unwrapped
      .toEqual({ name: 'runQuery', input: { sql: 'select 1' } });
  });
});

describe('toolFieldNames — declared arg names (protects a real `input` arg)', () => {
  it('reads shorthand keys as field names', () => {
    expect(toolFieldNames({ url: 'string' })).toEqual(['url']);
    expect(toolFieldNames({ selector: 'string', text: 'string' })).toEqual(['selector', 'text']);
  });
  it('reads a real JSON Schema\'s properties keys', () => {
    expect(toolFieldNames({ type: 'object', properties: { input: { type: 'string' } }, required: ['input'] })).toEqual(['input']);
  });
  it('empty for a missing/empty/non-object schema', () => {
    expect(toolFieldNames({})).toEqual([]);
    expect(toolFieldNames(null)).toEqual([]);
    expect(toolFieldNames(['a'])).toEqual([]);
  });
});

describe('normalizeToolSchema — shorthand → valid JSON Schema (native-calling arg contract)', () => {
  it('coerces a shorthand { field: type } into { type:object, properties:{ field:{type} } }', () => {
    expect(normalizeToolSchema({ url: 'string' }))
      .toEqual({ type: 'object', properties: { url: { type: 'string' } } });
    expect(normalizeToolSchema({ selector: 'string', amount: 'number' }))
      .toEqual({ type: 'object', properties: { selector: { type: 'string' }, amount: { type: 'number' } } });
  });
  it('an empty shorthand {} becomes an empty object schema (not a bare {})', () => {
    expect(normalizeToolSchema({})).toEqual({ type: 'object', properties: {} });
  });
  it('defaults an unrecognized value type to string', () => {
    expect(normalizeToolSchema({ x: 'weird' })).toEqual({ type: 'object', properties: { x: { type: 'string' } } });
  });
  it('passes through a real JSON Schema (type==="object") verbatim', () => {
    const real = { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] };
    expect(normalizeToolSchema(real)).toBe(real); // trusted as-is, not re-wrapped
  });
  it('does NOT false-positive a shorthand whose field is literally named "type" or "properties" (require type==="object")', () => {
    // { type:'string', value:'string' } is a tool taking a `type` arg, NOT a schema declaring type=string.
    expect(normalizeToolSchema({ type: 'string', value: 'string' }))
      .toEqual({ type: 'object', properties: { type: { type: 'string' }, value: { type: 'string' } } });
    // a typeless { properties:{…} } is treated as a shorthand field named `properties`, not a schema.
    expect(normalizeToolSchema({ properties: { a: { type: 'number' } } }))
      .toEqual({ type: 'object', properties: { properties: { a: { type: 'number' } } } });
  });
  it('skips prototype-pollution keys (__proto__/constructor/prototype) instead of assigning them', () => {
    const out = normalizeToolSchema({ ['__proto__']: 'string', url: 'string' }) as Record<string, unknown>;
    expect(out).toEqual({ type: 'object', properties: { url: { type: 'string' } } });
    expect(Object.getPrototypeOf(out.properties)).toBe(Object.prototype); // not polluted
  });
  it('keeps an object-valued per-property schema verbatim (constraints survive to native calling)', () => {
    expect(normalizeToolSchema({ url: { type: 'string', format: 'uri' }, mode: { enum: ['fast', 'safe'] } }))
      .toEqual({ type: 'object', properties: { url: { type: 'string', format: 'uri' }, mode: { enum: ['fast', 'safe'] } } });
  });
  it('honors real JSON-type names (integer/array/object/null), not just string/number/boolean', () => {
    expect(normalizeToolSchema({ count: 'integer', tags: 'array' }))
      .toEqual({ type: 'object', properties: { count: { type: 'integer' }, tags: { type: 'array' } } });
  });
  it('rejects an array (typeof []==="object") → empty object schema, not numeric-keyed garbage', () => {
    expect(normalizeToolSchema(['a', 'b'])).toEqual({ type: 'object', properties: {} });
  });
  it('an ARRAY-valued shorthand field does not become an (invalid) array property schema → defaults to string', () => {
    expect(normalizeToolSchema({ tags: ['a', 'b'], url: 'string' }))
      .toEqual({ type: 'object', properties: { tags: { type: 'string' }, url: { type: 'string' } } });
  });
  it('null/non-object degrades to an empty object schema', () => {
    expect(normalizeToolSchema(null)).toEqual({ type: 'object', properties: {} });
    expect(normalizeToolSchema('nope')).toEqual({ type: 'object', properties: {} });
  });
});

describe('capsToNativeTools — capability specs → OpenAI function shape', () => {
  it('maps name/description and NORMALIZES inputSchema into a valid JSON Schema for the function parameters', () => {
    const tools = capsToNativeTools([readSpec(), actSpec()]);
    expect(tools).toEqual([
      { type: 'function', function: { name: 'readPage', description: 'read the page', parameters: { type: 'object', properties: {} } } },
      // the lent shorthand { selector:'string' } becomes a real schema so the model fills `selector`, not the {name,input} envelope
      { type: 'function', function: { name: 'click', description: 'click an element', parameters: { type: 'object', properties: { selector: { type: 'string' } } } } },
    ]);
  });
  it('a navigate-style { url:string } shorthand yields a url property (the flail fix)', () => {
    const nav: CapabilitySpec = { name: 'navigate', description: 'go to a url', inputSchema: { url: 'string' }, isReadOnly: false, isDestructive: true };
    expect(capsToNativeTools([nav])[0].function.parameters)
      .toEqual({ type: 'object', properties: { url: { type: 'string' } } });
  });
  it('SKIPS a spec whose name violates the provider function-name constraint (no whole-array poison)', () => {
    const bad: CapabilitySpec = { name: 'read page.v2', description: 'space + dot', inputSchema: {}, isReadOnly: true };
    const tools = capsToNativeTools([readSpec(), bad, actSpec()]);
    expect(tools.map((t) => t.function.name)).toEqual(['readPage', 'click']); // the malformed one is dropped, the rest survive
  });
});

describe('renderAgentMessages — native message thread (Phase 2)', () => {
  it('empty steps → goal + first-action user messages only', () => {
    const m = renderAgentMessages('find jobs', []);
    expect(m).toHaveLength(2);
    expect(m.every((x) => x.role === 'user')).toBe(true);
    expect(String(m[0].content)).toContain('find jobs');
  });

  it('a tool step becomes a contiguous assistant{tool_calls} + tool{result} pair', () => {
    const m = renderAgentMessages('goal', [{ name: 'readPage', input: { x: 1 }, output: 'PAGE TEXT' }]);
    const ai = m.findIndex((x) => x.role === 'assistant');
    const asst = m[ai] as { tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> };
    expect(asst.tool_calls?.[0]).toMatchObject({ type: 'function', function: { name: 'readPage', arguments: JSON.stringify({ x: 1 }) } });
    const id = asst.tool_calls?.[0].id;
    expect(m[ai + 1]).toMatchObject({ role: 'tool', tool_call_id: id, content: 'PAGE TEXT' }); // contiguous + paired by id
  });

  it('does not throw when a tool input is circular/unserializable (safe-stringify guard)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => renderAgentMessages('goal', [{ name: 'click', input: circular, output: 'ok' }])).not.toThrow();
    const m = renderAgentMessages('goal', [{ name: 'click', input: circular, output: 'ok' }]);
    const asst = m.find((x) => x.role === 'assistant') as { tool_calls?: Array<{ function: { arguments: string } }> };
    expect(asst.tool_calls?.[0].function.arguments).toBe('{}'); // degraded, not crashed
  });

  it('a reminder step renders as a user instruction, not a tool pair', () => {
    const m = renderAgentMessages('goal', [{ name: 'reminder', input: {}, output: 'do something different' }]);
    expect(m.some((x) => x.role === 'assistant')).toBe(false);
    expect(m.some((x) => x.role === 'user' && x.content === 'do something different')).toBe(true);
  });

  it('bounds context: older tool results are trimmed, the last AGENT_MSG_KEEP_FULL stay verbatim', () => {
    const steps = Array.from({ length: AGENT_MSG_KEEP_FULL + 2 }, (_, i) => ({ name: 'readPage', input: { i }, output: `r${i}:${'x'.repeat(400)}` }));
    const toolMsgs = renderAgentMessages('goal', steps).filter((x) => x.role === 'tool');
    expect(toolMsgs).toHaveLength(steps.length);
    expect(String(toolMsgs[0].content)).toContain('[trimmed'); // oldest two trimmed
    expect(String(toolMsgs[1].content)).toContain('[trimmed');
    for (let k = 2; k < toolMsgs.length; k++) {
      expect(String(toolMsgs[k].content)).not.toContain('[trimmed'); // last KEEP_FULL kept whole
      expect(String(toolMsgs[k].content).length).toBeGreaterThan(400);
    }
  });
});

describe('AgenticTurnBrainClient — native function-calling drives the loop', () => {
  it('passes a reconstructed message thread to the adapter; it grows the tool pair after a call', async () => {
    const { client, dispatches } = makeAgentSteps([
      { parts: [{ kind: 'tool_call', toolName: 'readPage', toolCallId: 't1', args: {} }] },
      'Done.',
    ]);
    await client.open({ sessionId: 's', engineId: 'zai-coding-plan-glm-5.2', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true, output: 'PAGE' }), approval: () => 'approve' });
    expect(Array.isArray(dispatches[0].messages)).toBe(true);
    expect(dispatches[0].messages?.[0]).toMatchObject({ role: 'user' });
    // second dispatch (after readPage ran): the thread now carries the assistant/tool pair
    expect(dispatches[1].messages?.some((mm) => mm.role === 'assistant' && !!mm.tool_calls)).toBe(true);
    expect(dispatches[1].messages?.some((mm) => mm.role === 'tool' && mm.content === 'PAGE')).toBe(true);
  });

  it('omits messages when no capability is registered (nothing to call natively)', async () => {
    const { client, dispatches } = makeAgentSteps(['Just answering.']);
    await client.open({ sessionId: 's', engineId: 'zai-coding-plan-glm-5.2', cwd: '/tmp' });
    await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
    expect(dispatches[0].messages).toBeUndefined();
  });

  it('offers tools[] to the adapter on every dispatch (so API engines can call natively)', async () => {
    const { client, dispatches } = makeAgentSteps(['Just answering directly.']);
    await client.open({ sessionId: 's', engineId: 'zai-coding-plan-glm-5.2', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec() });
    await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
    expect(dispatches[0].tools).toBeDefined();
    expect((dispatches[0].tools ?? []).every((t) => t.type === 'function')).toBe(true);
    expect((dispatches[0].tools ?? []).map((t) => t.function.name).sort()).toEqual(['click', 'readPage']);
  });

  it('a NATIVE tool_call part (no text marker) drives the capability-request', async () => {
    const { client } = makeAgentSteps([
      { parts: [{ kind: 'tool_call', toolName: 'readPage', toolCallId: 't1', args: {} }] }, // native, no __AGON_TOOL__
      'The page is the Agon docs.',                                                          // prose final answer
    ]);
    await client.open({ sessionId: 's', engineId: 'minimax-coding-plan-minimax-m3', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: () => ({ ok: true, output: '<page text>' }),
      approval: () => 'approve',
    });
    expect(events.find((e) => e.kind === 'capability-request')).toMatchObject({ capability: 'readPage' });
    expect(events.find((e) => e.kind === 'engine')).toMatchObject({ content: 'The page is the Agon docs.' });
    expect(result.responded).toBe(true);
  });

  it('a native tool_call with EMPTY stdout still drives the loop (not misread as no-answer)', async () => {
    // Guards Fix A: the no-answer bail must not fire on a native tool-only turn whose stdout is
    // empty — emptiness is only "no answer" when there is ALSO no structured call. No <tool> echo.
    const { client } = makeAgentSteps([
      { parts: [{ kind: 'tool_call', toolName: 'readPage', toolCallId: 't1', args: {} }], stdout: '' },
      'Read it.',
    ]);
    await client.open({ sessionId: 's', engineId: 'zai-coding-plan-glm-5.2', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: () => ({ ok: true, output: '<page>' }),
      approval: () => 'approve',
    });
    expect(events.find((e) => e.kind === 'capability-request')).toMatchObject({ capability: 'readPage' });
    expect(events.some((e) => e.kind === 'notice' && /no answer/i.test((e as { message: string }).message))).toBe(false);
    expect(result.responded).toBe(true);
  });

  it('a native tool_call part takes PRECEDENCE over a stray text marker in stdout', async () => {
    // The dispatch carries a native click AND a readPage text-marker in stdout; the native one wins.
    let requested: string | undefined;
    const { client } = makeAgentSteps([
      { parts: [{ kind: 'tool_call', toolName: 'click', toolCallId: 't1', args: { selector: '#native' } }], stdout: `${MARK} {"name":"readPage","input":{}}` },
      'Done.',
    ]);
    await client.open({ sessionId: 's', engineId: 'kimi-for-coding-k2p7', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: actSpec() });
    const { result } = await driveAgent(client, client.runTurn(req('t1')), {
      capability: (ev) => { requested = (ev as { capability: string }).capability; return { ok: true, output: 'clicked' }; },
      approval: () => 'approve',
    });
    expect(requested).toBe('click');     // native part won, not the marker's readPage
    expect(result.responded).toBe(true);
  });
});

describe('transport-aware act protocol — native function-calling vs text marker', () => {
  it('native=true drops the __AGON_TOOL__ marker and instructs function-calling (still lists tools + proactivity)', () => {
    const p = buildAgentSystemPrompt([readSpec(), actSpec()], undefined, true);
    expect(p).not.toContain(MARK);                 // the competing text-marker instruction is GONE
    expect(p.toLowerCase()).toContain('function');  // it's told to CALL its function/tool interface
    expect(p).toContain('CALL THE TOOL NOW');
    expect(p).toContain('readPage');                // catalog still present
    expect(p).toContain('ACTS on the page');
    expect(p).toContain('BE PROACTIVE');            // shared guidance retained
  });
  it('default (marker) keeps the strict __AGON_TOOL__ protocol and the double-wrap warning', () => {
    const p = buildAgentSystemPrompt([readSpec()]);
    expect(p).toContain(MARK);
    expect(p).toContain('SECOND "input"');          // the marker-only anti-double-wrap note
  });
  it('a binary-LESS engine with an api block + key (kimi/minimax/zai) is dispatched the NATIVE prompt', async () => {
    process.env.AGON_FC_TEST_KEY = 'k'; // the predicate now matches the adapter: API path needs the key present
    try {
      const { client, dispatches } = makeAgentSteps(
        ['Just answering.'],
        () => ({ api: { baseUrl: 'https://api.x', apiKeyEnv: 'AGON_FC_TEST_KEY', model: 'm' } }), // no `binary` → API path
      );
      await client.open({ sessionId: 's', engineId: 'minimax-coding-plan-minimax-m3', cwd: '/tmp' });
      await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
      await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
      expect(dispatches[0].systemPrompt).toBeDefined();
      expect(dispatches[0].systemPrompt).not.toContain(MARK);
      expect((dispatches[0].systemPrompt ?? '').toLowerCase()).toContain('function');
    } finally { delete process.env.AGON_FC_TEST_KEY; }
  });
  it('a binary-DECLARING engine whose binary IS installed keeps the text-marker prompt', async () => {
    const { client, dispatches } = makeAgentSteps(
      ['Just answering.'],
      () => ({ binary: 'claude', api: { baseUrl: 'https://api.x', apiKeyEnv: 'AGON_FC_TEST_KEY', model: 'm' } }), // findBinary resolves → CLI path
    );
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
    expect(dispatches[0].systemPrompt).toContain(MARK);
  });
  it('a binary-DECLARING engine whose binary is MISSING (findBinary null) + key present gets the NATIVE prompt (matches adapter API fallback)', async () => {
    // The codex-0.92 edge case: declared-but-uninstalled binary dispatches via native API tools, so it
    // must NOT receive the marker prompt. Registry returns a binary but a findBinary that resolves null.
    process.env.AGON_FC_TEST_KEY = 'k';
    try {
      const dispatches: CapturedDispatch[] = [];
      const registry = {
        get: () => ({ binary: 'claude', api: { baseUrl: 'https://api.x', apiKeyEnv: 'AGON_FC_TEST_KEY', model: 'm' } }),
        listIds: () => ['claude'],
        findBinary: () => null, // declared but NOT on PATH → adapter would use API fallback
      } as unknown as EngineRegistry;
      const client = new AgenticTurnBrainClient(registry);
      (client as unknown as { adapter: EngineAdapter }).adapter = {
        dispatch: async (opts: CapturedDispatch) => { dispatches.push(opts); return { exitCode: 0, stdout: 'Just answering.', stderr: '', durationMs: 1, timedOut: false }; },
        isAvailable: async () => true,
      } as unknown as EngineAdapter;
      await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
      await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
      await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
      expect(dispatches[0].systemPrompt).not.toContain(MARK); // native prompt, not marker — no competing protocol
    } finally { delete process.env.AGON_FC_TEST_KEY; }
  });
  it('a native engine that NARRATES gets a nudge phrased for function-calling, not the marker', async () => {
    process.env.AGON_FC_TEST_KEY = 'k';
    try {
      const { client, dispatches } = makeAgentSteps(
        ['Let me read the page now.', 'Done.'], // step0 narration (no tool call) → nudge; step1 final answer
        () => ({ api: { baseUrl: 'https://api.x', apiKeyEnv: 'AGON_FC_TEST_KEY', model: 'm' } }),
      );
      await client.open({ sessionId: 's', engineId: 'kimi-for-coding-k2p7', cwd: '/tmp' });
      await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
      await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
      // The reminder injected after the narration becomes a user message in the reconstructed thread.
      const msgs = dispatches[1]?.messages ?? [];
      const nudge = msgs.find((m) => m.role === 'user' && typeof m.content === 'string' && /function\/tool-calling/i.test(m.content as string));
      expect(nudge).toBeDefined();                                                  // native phrasing present
      expect(msgs.some((m) => typeof m.content === 'string' && (m.content as string).includes(MARK))).toBe(false); // no marker text
    } finally { delete process.env.AGON_FC_TEST_KEY; }
  });
});

describe('sanitizeSchemaNode — deep prototype-pollution strip for object-valued schemas', () => {
  it('drops __proto__/constructor/prototype own-keys at every depth (kept constraints survive)', () => {
    // JSON.parse (not an object literal) is what makes "__proto__" an OWN enumerable key — the real vector.
    const dirty = JSON.parse('{"type":"string","format":"uri","__proto__":{"polluted":true},"meta":{"constructor":"x","keep":1}}');
    const clean = sanitizeSchemaNode(dirty) as Record<string, any>;
    expect(clean.type).toBe('string');
    expect(clean.format).toBe('uri');
    expect(clean.meta).toEqual({ keep: 1 });                                  // nested 'constructor' stripped, 'keep' survives
    expect(Object.prototype.hasOwnProperty.call(clean, '__proto__')).toBe(false);
  });
  it('passes non-objects through and maps arrays element-wise', () => {
    expect(sanitizeSchemaNode('string')).toBe('string');
    expect(sanitizeSchemaNode(5)).toBe(5);
    expect(sanitizeSchemaNode(null)).toBe(null);
    expect(sanitizeSchemaNode(JSON.parse('[{"a":1,"__proto__":{"x":1}}]'))).toEqual([{ a: 1 }]);
  });
  it('normalizeToolSchema deep-strips a malicious object-valued property schema', () => {
    const out = normalizeToolSchema(JSON.parse('{"q":{"type":"string","__proto__":{"polluted":true}}}')) as any;
    expect(out.properties.q.type).toBe('string');
    expect(Object.prototype.hasOwnProperty.call(out.properties.q, '__proto__')).toBe(false);
  });
});
