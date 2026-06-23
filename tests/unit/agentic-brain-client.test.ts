import { describe, it, expect } from 'vitest';

import {
  AgenticTurnBrainClient,
  createAgenticTurnBrainClient,
  parseAgentToolCall,
  buildAgentSystemPrompt,
  renderAgentTranscript,
  describeAgentAction,
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
  it('renderAgentTranscript shows the request and the running tool history', () => {
    expect(renderAgentTranscript('hello', [])).toContain('No tools have run yet');
    const t = renderAgentTranscript('hello', [{ name: 'readPage', input: {}, output: 'PAGE' }]);
    expect(t).toContain('User request: hello');
    expect(t).toContain('> readPage({})');
    expect(t).toContain('< PAGE');
  });
  it('describeAgentAction renders a compact one-liner and truncates huge inputs', () => {
    expect(describeAgentAction('click', { selector: '#buy' })).toBe('click({"selector":"#buy"})');
    expect(describeAgentAction('type', { v: 'x'.repeat(500) }).length).toBeLessThanOrEqual(170 + 'type()'.length);
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

  it('an unknown tool is reported back and the loop recovers to an answer', async () => {
    const client = makeAgent([`${MARK} {"name":"teleport","input":{}}`, 'I cannot do that here.']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    // no capability registered
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true }), approval: () => 'approve' });
    expect(events.some((e) => e.kind === 'capability-request')).toBe(false);
    expect(result.responded).toBe(true);
  });

  it('stops at the step limit when the engine never stops calling tools', async () => {
    const client = makeAgent([`${MARK} {"name":"readPage","input":{}}`]); // always a tool call
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c', spec: readSpec() });
    const { events, result } = await driveAgent(client, client.runTurn(req('t1')), { capability: () => ({ ok: true, output: 'p' }), approval: () => 'approve' });
    expect(result.responded).toBe(false);
    expect(result.reason).toMatch(/step limit/i);
    expect(events.filter((e) => e.kind === 'capability-request').length).toBeGreaterThan(1);
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

  it('factory builds an interface-conformant agent reporting liveness', async () => {
    const client = createAgenticTurnBrainClient({ get: (id: string) => ({ id }), listIds: () => ['claude'] } as unknown as EngineRegistry);
    const h = await client.health();
    expect(h.alive).toBe(true);
    expect(h.activeTurnId).toBeNull();
  });
});
