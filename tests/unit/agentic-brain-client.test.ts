import { describe, it, expect } from 'vitest';

import {
  AgenticTurnBrainClient,
  createAgenticTurnBrainClient,
  parseAgentToolCall,
  extractNativeToolCall,
  capsToNativeTools,
  buildAgentSystemPrompt,
  renderAgentTranscript,
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
  responders: { capability: (ev: BrainEvent) => { ok: boolean; output?: string; error?: string }; approval: (ev: BrainEvent) => string },
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

  it('nudges a DEFERRAL ("how would you like me to proceed?") into deciding and acting', async () => {
    // The "not agentic at all" failure (Image #7): it read the page then asked the user to drive.
    const client = makeAgent([
      'I can see the LinkedIn jobs page. How would you like me to proceed? 1. Open a job 2. Refine 3. Try another query.', // deferral, no tool → nudge
      `${MARK} {"name":"readPage","input":{}}`,        // now it decides and acts
      'I found 3 roles that fit your AI-tooling + frontend-lead profile: …',  // final RESULT
    ]);
    await client.open({ sessionId: 's', engineId: 'zai-coding-plan-glm-5.2', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1', 'find me cool jobs')), { capability: () => ({ ok: true, output: 'JOBS' }), approval: () => 'approve' });
    expect(events.some((e) => e.kind === 'notice' && /decide and continue/.test((e as { message: string }).message))).toBe(true); // deferral was caught
    expect(events.some((e) => e.kind === 'capability-request')).toBe(true); // it then actually acted
    expect(result.responded).toBe(true);
    expect(events.find((e) => e.kind === 'engine')).toMatchObject({ content: expect.stringContaining('3 roles that fit') });
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
  it('declares clientCapabilities supported + host-only approvals + per-turn cancel', () => {
    const client = makeAgent(['x']);
    expect(client.controlCapabilities).toEqual({
      concurrentTurns: 'per-session-serialized',
      concurrentSteering: 'unsupported',
      approvalArbitration: 'host-only',
      questionArbitration: 'unsupported',
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
function makeAgentSteps(steps: Step[]): { client: AgenticTurnBrainClient; dispatches: Array<{ tools?: Array<{ type: string; function: { name: string } }> }> } {
  let i = 0;
  const dispatches: Array<{ tools?: Array<{ type: string; function: { name: string } }> }> = [];
  const registry = { get: (id: string) => ({ id }), listIds: () => ['claude', 'codex'] } as unknown as EngineRegistry;
  const client = new AgenticTurnBrainClient(registry);
  (client as unknown as { adapter: EngineAdapter }).adapter = {
    dispatch: async (opts: { tools?: Array<{ type: string; function: { name: string } }> }) => {
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

describe('capsToNativeTools — capability specs → OpenAI function shape', () => {
  it('maps name/description and uses inputSchema as the function parameters', () => {
    const tools = capsToNativeTools([readSpec(), actSpec()]);
    expect(tools).toEqual([
      { type: 'function', function: { name: 'readPage', description: 'read the page', parameters: {} } },
      { type: 'function', function: { name: 'click', description: 'click an element', parameters: { selector: 'string' } } },
    ]);
  });
  it('SKIPS a spec whose name violates the provider function-name constraint (no whole-array poison)', () => {
    const bad: CapabilitySpec = { name: 'read page.v2', description: 'space + dot', inputSchema: {}, isReadOnly: true };
    const tools = capsToNativeTools([readSpec(), bad, actSpec()]);
    expect(tools.map((t) => t.function.name)).toEqual(['readPage', 'click']); // the malformed one is dropped, the rest survive
  });
});

describe('AgenticTurnBrainClient — native function-calling drives the loop', () => {
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
