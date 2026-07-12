import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as brainContract from '../../packages/core/src/generated/sessions/brain-client.js';
import type {
  BrainEvent,
  BrainTurnResult,
  CapabilityAuthorizationLease,
  CapabilitySpec,
  EngineAdapter,
  EngineRegistry,
} from '../../packages/core/src/generated/sessions/brain-client.js';
import { AgenticTurnBrainClient, AGENT_TOOL_MARKER as MARK } from '../../packages/cli/src/generated/bridge/agentic-brain-client.js';
import { createAgonServe } from '../../packages/cli/src/generated/bridge/agon-serve.js';
import * as drive from '../../packages/cli/src/generated/commands/drive.js';
import type { BrainClient } from '@kernlang/agon-core';

type ApprovalDecision = 'approve' | 'approve-session' | 'deny' | 'deny-session' | 'abort';
type ApprovalReply = { decision: ApprovalDecision; automated?: boolean };

const digest = (input: Record<string, unknown>): string => {
  const fn = (brainContract as unknown as { canonicalCapabilityInputDigest?: (value: Record<string, unknown>) => string }).canonicalCapabilityInputDigest;
  expect(typeof fn).toBe('function');
  return fn ? fn(input) : '';
};

const actSpec: CapabilitySpec = {
  name: 'click',
  description: 'click an element',
  inputSchema: { selector: 'string' },
  isReadOnly: false,
  isDestructive: true,
};

function makeAgent(responses: string[]): AgenticTurnBrainClient {
  let i = 0;
  const registry = {
    get: (id: string) => ({ id }),
    listIds: () => ['claude'],
  } as unknown as EngineRegistry;
  const client = new AgenticTurnBrainClient(registry);
  (client as unknown as { adapter: EngineAdapter }).adapter = {
    dispatch: async () => ({
      exitCode: 0,
      stdout: responses[Math.min(i++, responses.length - 1)],
      stderr: '',
      durationMs: 1,
      timedOut: false,
    }),
    isAvailable: async () => true,
  } as unknown as EngineAdapter;
  return client;
}

async function driveTurn(
  client: AgenticTurnBrainClient,
  turnId: string,
  submitterClientId: string,
  approval: ApprovalReply,
): Promise<{ events: BrainEvent[]; result: BrainTurnResult; approvalCount: number }> {
  const events: BrainEvent[] = [];
  let approvalCount = 0;
  const gen = client.runTurn({ sessionId: 's', turnId, clientId: submitterClientId, input: 'click it' });
  let item = await gen.next();
  while (!item.done) {
    const event = item.value;
    events.push(event);
    if (event.kind === 'approval-request') {
      approvalCount++;
      queueMicrotask(() => {
        void client.provideApproval({
          sessionId: 's',
          requestId: event.requestId,
          clientId: submitterClientId,
          decision: approval.decision,
          ...(approval.automated === undefined ? {} : { automated: approval.automated }),
        });
      });
    } else if (event.kind === 'capability-request') {
      queueMicrotask(() => {
        void client.provideCapabilityResult({
          sessionId: 's',
          requestId: event.requestId,
          clientId: event.targetClientId ?? 'c-ext',
          ok: true,
          output: 'clicked',
        });
      });
    }
    item = await gen.next();
  }
  return { events, result: item.value, approvalCount };
}

const capabilityRequest = (events: BrainEvent[]): Extract<BrainEvent, { kind: 'capability-request' }> => {
  const event = events.find((candidate): candidate is Extract<BrainEvent, { kind: 'capability-request' }> => candidate.kind === 'capability-request');
  expect(event).toBeDefined();
  return event!;
};

const leaseCapabilityRequestId = (request: Extract<BrainEvent, { kind: 'capability-request' }>): string | undefined =>
  request.authorization?.capabilityRequestId;

describe('canonical capability input digest', () => {
  it('is deterministic across object key order while preserving array order and value types', () => {
    const a = { z: 3, nested: { beta: true, alpha: 'x' }, list: [1, '1', null] };
    const b = { list: [1, '1', null], nested: { alpha: 'x', beta: true }, z: 3 };
    expect(digest(a)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(digest(a)).toBe(digest(b));
    expect(digest({ list: [1, 2] })).not.toBe(digest({ list: [2, 1] }));
    expect(digest({ value: 1 })).not.toBe(digest({ value: '1' }));
    expect(digest({ selector: '#buy', options: { force: false, retries: 0 } })).toBe(
      'sha256:580412acea471d1c12909e74913f784478ff6c2b458e1ced1edeb3d9f5054999',
    );
  });

  it('fails closed when a runtime caller passes a non-object root', () => {
    for (const value of [null, [], 'selector', 1, true]) {
      expect(() => digest(value as unknown as Record<string, unknown>)).toThrow(TypeError);
    }
  });
});

describe('destructive capability authorization leases', () => {
  it('emits an exact once lease, defaults omitted automated to false, and does not persist it', async () => {
    const input = { selector: '#buy', options: { force: false, retries: 0 } };
    const nextInput = { selector: '#confirm' };
    const client = makeAgent([
      `${MARK} ${JSON.stringify({ name: 'click', input })}`, 'done',
      `${MARK} ${JSON.stringify({ name: 'click', input: nextInput })}`, 'done again',
    ]);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c-ext', spec: actSpec });

    const { events, result } = await driveTurn(client, 'turn-once', 'c-cli', { decision: 'approve' });
    const approval = events.find((event): event is Extract<BrainEvent, { kind: 'approval-request' }> => event.kind === 'approval-request')!;
    const request = capabilityRequest(events);
    const authorization = request.authorization as CapabilityAuthorizationLease;

    expect(result.responded).toBe(true);
    expect(approval.input).toEqual(input);
    expect(request.turnId).toBe('turn-once');
    expect(request.turnId).toBe(authorization.turnId);
    expect(authorization).toEqual({
      turnId: 'turn-once',
      capabilityRequestId: request.requestId,
      approvalRequestId: approval.requestId,
      submitterClientId: 'c-cli',
      targetClientId: 'c-ext',
      capability: 'click',
      inputDigest: digest(input),
      mode: 'once',
      automated: false,
    });
    expect(JSON.parse(JSON.stringify(request)).authorization).toEqual(authorization);

    const again = await driveTurn(client, 'turn-once-again', 'c-cli', { decision: 'approve' });
    const nextApproval = again.events.find((event): event is Extract<BrainEvent, { kind: 'approval-request' }> => event.kind === 'approval-request')!;
    const nextRequest = capabilityRequest(again.events);
    expect(again.approvalCount).toBe(1);
    expect(nextRequest.authorization).toMatchObject({
      turnId: 'turn-once-again', mode: 'once', approvalRequestId: nextApproval.requestId, inputDigest: digest(nextInput),
    });
    expect(leaseCapabilityRequestId(nextRequest)).toBe(nextRequest.requestId);
    expect(leaseCapabilityRequestId(request)).not.toBe(nextRequest.requestId);
    expect(nextApproval.requestId).not.toBe(approval.requestId);
  });

  it('scopes session approval, preserves provenance, and rejects lease replay on a fresh request id', async () => {
    const first = { selector: '#first' };
    const second = { selector: '#second' };
    const third = { selector: '#third' };
    const typed = { selector: '#field', text: 'hello' };
    const client = makeAgent([
      `${MARK} ${JSON.stringify({ name: 'click', input: first })}`, 'first done',
      `${MARK} ${JSON.stringify({ name: 'click', input: second })}`, 'second done',
      `${MARK} ${JSON.stringify({ name: 'click', input: third })}`, 'third done',
      `${MARK} ${JSON.stringify({ name: 'type', input: typed })}`, 'typing done',
    ]);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c-ext', spec: actSpec });
    await client.registerCapability({ sessionId: 's', clientId: 'c-ext', spec: { ...actSpec, name: 'type' } });

    const one = await driveTurn(client, 'turn-1', 'c-cli-a', { decision: 'approve-session', automated: true });
    const originalApproval = one.events.find((event): event is Extract<BrainEvent, { kind: 'approval-request' }> => event.kind === 'approval-request')!;
    const two = await driveTurn(client, 'turn-2', 'c-cli-a', { decision: 'deny' });
    const three = await driveTurn(client, 'turn-3', 'c-cli-b', { decision: 'approve', automated: false });
    const four = await driveTurn(client, 'turn-4', 'c-cli-a', { decision: 'approve', automated: false });

    expect(one.approvalCount).toBe(1);
    expect(two.approvalCount).toBe(0);
    expect(three.approvalCount).toBe(1);
    expect(four.approvalCount).toBe(1);
    const firstSessionRequest = capabilityRequest(one.events);
    const secondSessionRequest = capabilityRequest(two.events);
    expect(firstSessionRequest.authorization).toMatchObject({
      turnId: 'turn-1', mode: 'session', automated: true, approvalRequestId: originalApproval.requestId,
      submitterClientId: 'c-cli-a', inputDigest: digest(first),
    });
    expect(secondSessionRequest.authorization).toMatchObject({
      turnId: 'turn-2', mode: 'session', automated: true, approvalRequestId: originalApproval.requestId,
      submitterClientId: 'c-cli-a', inputDigest: digest(second),
    });
    expect(leaseCapabilityRequestId(firstSessionRequest)).toBe(firstSessionRequest.requestId);
    expect(leaseCapabilityRequestId(secondSessionRequest)).toBe(secondSessionRequest.requestId);
    expect(secondSessionRequest.requestId).not.toBe(firstSessionRequest.requestId);
    expect(leaseCapabilityRequestId(firstSessionRequest)).not.toBe(secondSessionRequest.requestId);
    expect(capabilityRequest(three.events).authorization).toMatchObject({
      turnId: 'turn-3', mode: 'once', automated: false,
      submitterClientId: 'c-cli-b', inputDigest: digest(third),
    });
    expect(capabilityRequest(four.events)).toMatchObject({
      capability: 'type', authorization: { mode: 'once', submitterClientId: 'c-cli-a', inputDigest: digest(typed) },
    });
  });

  it('requires fresh approval whenever a capability is re-registered, including owner or spec changes', async () => {
    const client = makeAgent([
      `${MARK} {"name":"click","input":{"selector":"#one"}}`, 'first done',
      `${MARK} {"name":"click","input":{"selector":"#two"}}`, 'second done',
      `${MARK} {"name":"click","input":{"selector":"#three"}}`, 'third done',
    ]);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c-ext-a', spec: actSpec });
    const first = await driveTurn(client, 'turn-registration-1', 'c-cli', { decision: 'approve-session', automated: true });

    await client.registerCapability({ sessionId: 's', clientId: 'c-ext-b', spec: actSpec });
    const newOwner = await driveTurn(client, 'turn-registration-2', 'c-cli', { decision: 'approve', automated: false });
    await client.registerCapability({ sessionId: 's', clientId: 'c-ext-b', spec: { ...actSpec, description: 'changed click semantics' } });
    const changedSpec = await driveTurn(client, 'turn-registration-3', 'c-cli', { decision: 'approve', automated: false });

    expect(first.approvalCount).toBe(1);
    expect(newOwner.approvalCount).toBe(1);
    expect(changedSpec.approvalCount).toBe(1);
    expect(capabilityRequest(newOwner.events)).toMatchObject({ targetClientId: 'c-ext-b', authorization: { targetClientId: 'c-ext-b', mode: 'once' } });
    expect(capabilityRequest(changedSpec.events)).toMatchObject({ targetClientId: 'c-ext-b', authorization: { targetClientId: 'c-ext-b', mode: 'once' } });
  });

  it('close revokes registered capabilities before the client can be reopened', async () => {
    const client = makeAgent([`${MARK} {"name":"click","input":{"selector":"#stale"}}`, 'no stale capability']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c-ext', spec: actSpec });
    await client.close();
    await client.open({ sessionId: 's2', engineId: 'claude', cwd: '/tmp' });

    const afterReopen = await driveTurn(client, 'turn-after-close', 'c-cli', { decision: 'approve' });
    expect(afterReopen.approvalCount).toBe(0);
    expect(afterReopen.events.some((event) => event.kind === 'capability-request')).toBe(false);
  });

  it('rejects malformed runtime tool input before approval or capability execution', async () => {
    const client = makeAgent([`${MARK} {"name":"click","input":["#unsafe"]}`, 'malformed call handled']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c-ext', spec: actSpec });

    const malformed = await driveTurn(client, 'turn-malformed-input', 'c-cli', { decision: 'approve-session', automated: true });
    expect(malformed.result.responded).toBe(true);
    expect(malformed.approvalCount).toBe(0);
    expect(malformed.events.some((event) => event.kind === 'capability-request')).toBe(false);
    expect(malformed.events).toContainEqual(expect.objectContaining({ kind: 'tool', tool: 'click', status: 'error' }));
  });

  it('stops after four consecutive malformed runtime inputs instead of flailing to the step limit', async () => {
    const client = makeAgent([
      `${MARK} {"name":"click","input":["#one"]}`,
      `${MARK} {"name":"click","input":["#two"]}`,
      `${MARK} {"name":"click","input":["#three"]}`,
      `${MARK} {"name":"click","input":["#four"]}`,
    ]);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c-ext', spec: actSpec });

    const malformed = await driveTurn(client, 'turn-malformed-streak', 'c-cli', { decision: 'approve' });
    expect(malformed.result).toMatchObject({ responded: false, reason: expect.stringContaining('4 tool calls in a row failed') });
    expect(malformed.events.filter((event) => event.kind === 'tool' && event.status === 'error')).toHaveLength(4);
    expect(malformed.events.some((event) => event.kind === 'approval-request' || event.kind === 'capability-request')).toBe(false);
  });

  it('fails closed on an unrecognized runtime approval decision', async () => {
    const client = makeAgent([`${MARK} {"name":"click","input":{"selector":"#unsafe"}}`, 'not executed']);
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    await client.registerCapability({ sessionId: 's', clientId: 'c-ext', spec: actSpec });
    const invalid = await driveTurn(client, 'turn-invalid-decision', 'c-cli', { decision: 'future-decision' as ApprovalDecision });
    expect(invalid.approvalCount).toBe(1);
    expect(invalid.events.some((event) => event.kind === 'capability-request')).toBe(false);
    expect(invalid.events).toContainEqual(expect.objectContaining({ kind: 'tool', tool: 'click', status: 'error' }));
  });
});

describe('approval provenance wire contract', () => {
  let serve: ReturnType<typeof createAgonServe>;
  let url = '';
  let token = '';
  const seen: Array<{ automated?: boolean; clientId: string; requestId: string }> = [];

  beforeAll(async () => {
    const brain = {
      async *runTurn(req: { turnId: string }) {
        return { turnId: req.turnId, delegated: false, responded: true };
      },
      async provideApproval(res: { automated?: boolean; clientId: string; requestId: string }) {
        seen.push(res);
        return { status: 'accepted' as const };
      },
    } as unknown as BrainClient;
    serve = createAgonServe({ brain, sessionId: 'wire', allowedOrigins: [] });
    ({ url, token } = await serve.start());
  });

  afterAll(async () => { await serve.close(); });

  it('POST /approval forwards explicit automated=true and defaults omission to false', async () => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const post = (body: Record<string, unknown>) => fetch(`${url}/approval`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await post({ requestId: 'auto', clientId: 'cli', decision: 'approve', automated: true })).status).toBe(200);
    expect((await post({ requestId: 'manual', clientId: 'cli', decision: 'approve' })).status).toBe(200);
    expect(seen).toEqual([
      expect.objectContaining({ requestId: 'auto', clientId: 'cli', automated: true }),
      expect.objectContaining({ requestId: 'manual', clientId: 'cli', automated: false }),
    ]);
  });

  it('builds CLI approval bodies with auto-approve=true and interactive/REPL=false provenance', () => {
    const fn = (drive as unknown as { buildApprovalPostBody?: (requestId: string, clientId: string, decision: ApprovalDecision, automated: boolean) => Record<string, unknown> }).buildApprovalPostBody;
    expect(typeof fn).toBe('function');
    if (!fn) return;
    expect(fn('r-auto', 'cli', 'approve', true)).toEqual({ requestId: 'r-auto', clientId: 'cli', decision: 'approve', automated: true });
    expect(fn('r-manual', 'cli', 'approve-session', false)).toEqual({ requestId: 'r-manual', clientId: 'cli', decision: 'approve-session', automated: false });
    expect(fn('r-repl', 'repl', 'approve', false)).toEqual({ requestId: 'r-repl', clientId: 'repl', decision: 'approve', automated: false });
  });
});
