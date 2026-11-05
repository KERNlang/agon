import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResumeSession } from '../../packages/core/src/persistent-session.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

type Handler = (req: IncomingMessage, res: ServerResponse, requestNumber: number) => void;

const KEY_ENV = 'AGON_RETRY_TEST_KEY';
const TOOLS = [
  { type: 'function', function: { name: 'Bash', description: 'b', parameters: { type: 'object', properties: {} } } },
] as any;

function sse(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
}

function respondText(res: ServerResponse, text: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(sse({ role: 'assistant', content: text }));
  res.write(sse({}, 'stop'));
  res.end('data: [DONE]\n\n');
}

function respondStatus(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ error: { message: `status ${status}` } }));
}

let server: Server;
let requestTimes: number[];
let home: string;
let toolCalls: number;

async function startStub(handler: Handler): Promise<string> {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      requestTimes.push(Date.now());
      handler(req, res, requestTimes.length);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

async function sessionFor(baseUrl: string, retry: Record<string, number> = {}, format: 'openai' | 'anthropic' = 'openai') {
  const session = createResumeSession({
    engine: {
      id: `retry-stub-${Math.random().toString(36).slice(2)}`,
      api: { baseUrl, apiKeyEnv: KEY_ENV, model: 'm', format, modelRetryBaseDelayMs: 10, modelRetryMaxDelayMs: 40, ...retry },
    } as any,
    binaryPath: '',
    cwd: process.cwd(),
    systemPrompt: 'You are Cesar.',
    nativeTools: TOOLS,
    onToolCall: async () => { toolCalls++; return 'ok'; },
  });
  await session.start();
  return session;
}

async function collect(gen: AsyncIterable<any>) {
  const chunks: any[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

const ofType = (chunks: any[], type: string) => chunks.filter((c) => c.type === type);
const retryStatuses = (chunks: any[]) => chunks.filter((c) => c.type === 'status' && c.metadata?.kind === 'model-retry');

beforeEach(() => {
  home = setupTestAgonHome('model-call-retry');
  process.env[KEY_ENV] = 'test-key';
  requestTimes = [];
  toolCalls = 0;
});

afterEach(async () => {
  delete process.env[KEY_ENV];
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  cleanupTestAgonHome(home);
  vi.restoreAllMocks();
});

describe('Cesar model-call retry against a real HTTP stub', () => {
  it('never replays or executes a tool call when the stream dies after it was emitted', async () => {
    const baseUrl = await startStub((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const event = (data: Record<string, unknown>) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
      event({ type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', content: [], model: 'm', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
      event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'Bash', input: {} } });
      event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"touch x"}' } });
      event({ type: 'content_block_stop', index: 0 });
      setTimeout(() => res.destroy(), 100);
    });
    const session = await sessionFor(baseUrl, {}, 'anthropic');

    const chunks = await collect(session.send({ message: 'go' }));

    expect(ofType(chunks, 'text').map((c) => c.content).join('')).toContain('<tool name="Bash">');
    expect(requestTimes).toHaveLength(1);
    expect(toolCalls).toBe(0);
    expect(ofType(chunks, 'error')).toHaveLength(1);
    expect(retryStatuses(chunks)).toHaveLength(0);
  });

  it('surfaces a stream that dies after text as an error instead of a silently truncated answer', async () => {
    const baseUrl = await startStub((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse({ role: 'assistant', content: 'partial answer' }));
      setTimeout(() => res.destroy(), 30);
    });
    const session = await sessionFor(baseUrl);

    const chunks = await collect(session.send({ message: 'go' }));

    expect(requestTimes).toHaveLength(1);
    expect(ofType(chunks, 'text').map((c) => c.content).join('')).toBe('partial answer');
    expect(ofType(chunks, 'error')[0]?.content).toMatch(/after output started/i);
  });

  it('stops immediately when Esc lands during backoff, with no further request', async () => {
    const baseUrl = await startStub((_req, res) => respondStatus(res, 503, { 'retry-after': '30' }));
    const session = await sessionFor(baseUrl);
    const abort = new AbortController();

    const started = Date.now();
    const chunks: any[] = [];
    for await (const chunk of session.send({ message: 'go', signal: abort.signal })) {
      chunks.push(chunk);
      if (chunk.metadata?.kind === 'model-retry') abort.abort();
    }

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(requestTimes).toHaveLength(1);
    expect(retryStatuses(chunks)).toHaveLength(1);
  });

  it('waits out Retry-After on a 429 and shows the wait instead of stalling silently', async () => {
    const baseUrl = await startStub((_req, res, n) => {
      if (n === 1) respondStatus(res, 429, { 'retry-after': '1' });
      else respondText(res, 'recovered');
    });
    const session = await sessionFor(baseUrl);

    const chunks = await collect(session.send({ message: 'go' }));

    expect(requestTimes).toHaveLength(2);
    expect(requestTimes[1]! - requestTimes[0]!).toBeGreaterThanOrEqual(1_000);
    expect(retryStatuses(chunks)[0]?.content).toMatch(/rate limited \(429\), retry 1\/5 in 1s/);
    expect(ofType(chunks, 'error')).toHaveLength(0);
    expect(ofType(chunks, 'text').map((c) => c.content).join('')).toBe('recovered');
  });

  it.each([401, 403, 400])('does not retry a %i, which would hammer a provider that already refused', async (status) => {
    const baseUrl = await startStub((_req, res) => respondStatus(res, status));
    const session = await sessionFor(baseUrl);

    const chunks = await collect(session.send({ message: 'go' }));

    expect(requestTimes).toHaveLength(1);
    expect(retryStatuses(chunks)).toHaveLength(0);
    expect(ofType(chunks, 'error')[0]?.metadata?.modelRetryFinal).toBe(true);
  });

  it('refuses a Retry-After beyond the configured wait cap instead of stalling for it', async () => {
    const baseUrl = await startStub((_req, res) => respondStatus(res, 429, { 'retry-after': '3600' }));
    const session = await sessionFor(baseUrl, { modelRetryMaxWaitMs: 5_000 });

    const started = Date.now();
    const chunks = await collect(session.send({ message: 'go' }));

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(requestTimes).toHaveLength(1);
    expect(ofType(chunks, 'error')[0]?.content).toMatch(/5s retry cap/);
  });

  it('holds a turn to its retry budget across sends, so failing calls with fresh timeouts cannot add up', async () => {
    const baseUrl = await startStub((_req, res) => respondStatus(res, 500));
    const session = await sessionFor(baseUrl, { modelRetryMaxRetries: 500, modelRetryMaxElapsedMs: 200 });
    const controlPlane = { turnId: 'turn-1' } as any;

    const first = await collect(session.send({ message: 'go', controlPlane }));
    const requestsAfterFirst = requestTimes.length;
    const second = await collect(session.send({ message: 'again', controlPlane }));

    expect(ofType(first, 'error')[0]?.content).toMatch(/retry budget/);
    expect(requestsAfterFirst).toBeLessThan(40);
    expect(requestTimes.length).toBeLessThanOrEqual(requestsAfterFirst + 2);
    expect(ofType(second, 'error')[0]?.content).toMatch(/retry budget/);
  });

  it('charges a slow first failure to the turn budget, so one per send cannot outrun the elapsed cap', async () => {
    let failNext = false;
    const baseUrl = await startStub((_req, res) => {
      if (!failNext) return respondText(res, 'recovered');
      failNext = false;
      setTimeout(() => respondStatus(res, 500), 150);
    });
    const session = await sessionFor(baseUrl, { modelRetryMaxRetries: 500, modelRetryMaxElapsedMs: 400 });
    const controlPlane = { turnId: 'turn-1' } as any;

    const errors: string[] = [];
    for (let send = 0; send < 5; send++) {
      failNext = true;
      const chunks = await collect(session.send({ message: `go ${send}`, controlPlane }));
      errors.push(...ofType(chunks, 'error').map((c) => c.content));
    }

    expect(errors[0]).toMatch(/retry budget/);
  });

  it('stops after the configured retries on a persistent 500 so one outage cannot retry forever', async () => {
    const baseUrl = await startStub((_req, res) => respondStatus(res, 500));
    const session = await sessionFor(baseUrl, { modelRetryMaxRetries: 2 });

    const chunks = await collect(session.send({ message: 'go' }));

    expect(requestTimes).toHaveLength(3);
    expect(ofType(chunks, 'error')[0]?.content).toMatch(/gave up after 2 retries/i);
    expect(ofType(chunks, 'error')[0]?.metadata?.modelRetryFinal).toBe(true);
  });
});
