import { beforeEach, describe, expect, it, vi } from 'vitest';

const { appendMessageMock } = vi.hoisted(() => ({ appendMessageMock: vi.fn() }));

vi.mock('@kernlang/agon-core', async () => {
  class StreamParser {
    private buffer = '';
    feed(chunk: string) {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      return lines.flatMap((line) => {
        if (!line.trim()) return [];
        const message = JSON.parse(line);
        return message.message.content.map((block: { text: string }) => ({ type: 'text', content: block.text }));
      });
    }
    flush() { return []; }
  }

  return {
    RUNS_DIR: '/tmp/agon-runs',
    appendMessage: appendMessageMock,
    tracker: { record: vi.fn() },
    StreamParser,
    loadConfig: vi.fn(() => ({})),
    sessionContext: { get: vi.fn(() => '') },
    resolveWorkingDir: vi.fn(() => '/tmp'),
    loadOrCreateActiveThread: vi.fn(() => ({ append: vi.fn(), save: vi.fn() })),
    createStreamBridge: vi.fn((dispatch: (event: unknown) => void) => ({
      bridge: ({ engineId, text }: { engineId: string; text: string }) => dispatch({ type: 'streaming-chunk', engineId, chunk: text }),
    })),
    formatChatContextForPrompt: vi.fn(() => ''),
  };
});

vi.mock('../../packages/cli/src/generated/cesar/brain-helpers.js', () => ({
  yieldToInk: vi.fn(async () => {}),
}));

import { handleChat } from '../../packages/cli/src/generated/handlers/chat.js';

describe('handleChat streamed terminal outcomes', () => {
  beforeEach(() => appendMessageMock.mockClear());

  it('shows partial output but does not persist a timed-out stream as success', async () => {
    const events: any[] = [];
    const dispatchAgentStream = async function* () {
      yield `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'partial analysis' }] } })}\n`;
      return {
        exitCode: 124,
        stdout: 'partial analysis',
        stderr: 'API agent timed out',
        durationMs: 100,
        timedOut: true,
        diff: '',
        diffLines: 0,
        filesChanged: 0,
      };
    };
    const ctx: any = {
      activeEngines: () => ['api-engine'],
      config: { forgeFixedStarter: 'api-engine', sessionContinuity: false },
      registry: { get: () => ({ id: 'api-engine', timeout: 60, agent: true, api: { model: 'test' } }) },
      adapter: { dispatchAgentStream },
      chatSession: { messages: [] },
      setActiveAbort: vi.fn(),
    };

    await handleChat('continue the task', (event: any) => events.push(event), ctx);

    expect(events).toContainEqual(expect.objectContaining({ type: 'streaming-chunk', chunk: 'partial analysis' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringContaining('API agent timed out') }));
    expect(appendMessageMock).not.toHaveBeenCalled();
  });

  it('does not persist a failed ordinary stream as success', async () => {
    const events: any[] = [];
    const dispatchStream = async function* () {
      yield `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'partial response' }] } })}\n`;
      return {
        exitCode: 124,
        stdout: 'partial response',
        stderr: 'stream timed out',
        durationMs: 100,
        timedOut: true,
      };
    };
    const ctx: any = {
      activeEngines: () => ['stream-engine'],
      config: { forgeFixedStarter: 'stream-engine', sessionContinuity: false },
      registry: { get: () => ({ id: 'stream-engine', timeout: 60, agent: false }) },
      adapter: { dispatchStream },
      chatSession: { messages: [] },
      setActiveAbort: vi.fn(),
    };

    await handleChat('continue the task', (event: any) => events.push(event), ctx);

    expect(events).toContainEqual(expect.objectContaining({ type: 'streaming-chunk', chunk: 'partial response' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringContaining('stream timed out') }));
    expect(appendMessageMock).not.toHaveBeenCalled();
  });

  it('closes an agent stream immediately when the active turn is aborted', async () => {
    let activeAbort: AbortController | null = null;
    let closed = false;
    const dispatchAgentStream = async function* () {
      try {
        activeAbort!.abort();
        yield `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'late chunk' }] } })}\n`;
      } finally {
        closed = true;
      }
      return {
        exitCode: 130,
        stdout: '',
        stderr: 'aborted',
        durationMs: 1,
        timedOut: false,
      };
    };
    const ctx: any = {
      activeEngines: () => ['api-engine'],
      config: { forgeFixedStarter: 'api-engine', sessionContinuity: false },
      registry: { get: () => ({ id: 'api-engine', timeout: 60, agent: true }) },
      adapter: { dispatchAgentStream },
      chatSession: { messages: [] },
      setActiveAbort: (controller: AbortController | null) => { activeAbort = controller; },
    };

    await handleChat('stop safely', vi.fn(), ctx);

    expect(closed).toBe(true);
    expect(appendMessageMock).not.toHaveBeenCalled();
  });
});
