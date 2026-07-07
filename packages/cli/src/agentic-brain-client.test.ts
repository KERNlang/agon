import { describe, expect, it } from 'vitest';
import { MAX_DISPATCH_IMAGE_BYTES } from '@kernlang/agon-core';
import { AgenticTurnBrainClient, buildAgentSystemPrompt } from './generated/bridge/agentic-brain-client.js';
import { MAX_SEND_BODY_BYTES } from './generated/bridge/agon-serve.js';

function pngFixture(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 2;
  return buf;
}

describe('buildAgentSystemPrompt computer-use guidance', () => {
  it('adds pixel coordinate guidance only when screenshot or clickAt tools exist', () => {
    const none = buildAgentSystemPrompt([
      { name: 'readPage', description: 'Read page', inputSchema: {}, isReadOnly: true },
    ]);
    expect(none).not.toContain('COMPUTER USE:');

    const withScreenshot = buildAgentSystemPrompt([
      { name: 'screenshot', description: 'Capture view', inputSchema: {}, isReadOnly: true },
      { name: 'clickAt', description: 'Click coordinates', inputSchema: {}, isReadOnly: false },
    ]);
    expect(withScreenshot).toContain('COMPUTER USE:');
    expect(withScreenshot).toContain('clickAt coordinates are CSS pixels from the viewport top-left.');
    expect(withScreenshot).toContain('NEVER guess coordinates without a fresh screenshot');
  });
});

describe('AgonServe body cap', () => {
  it('accepts one 5 MB image as a base64 data URL inside /capability-result JSON', () => {
    const dataUrl = `data:image/png;base64,${Buffer.alloc(MAX_DISPATCH_IMAGE_BYTES).toString('base64')}`;
    const bodyBytes = Buffer.byteLength(JSON.stringify({
      requestId: 'r',
      clientId: 'c',
      ok: true,
      output: dataUrl,
    }));
    expect(bodyBytes).toBeLessThanOrEqual(MAX_SEND_BODY_BYTES);
  });
});

describe('AgenticTurnBrainClient screenshot transcript', () => {
  it('includes parsed screenshot dimensions in the next tool-result placeholder', async () => {
    const engine = { id: 'test-engine', displayName: 'Test Engine', binary: 'test-engine' };
    const registry = {
      listIds: () => ['test-engine'],
      get: () => engine,
      findBinary: () => '/bin/test-engine',
    };
    const dispatches: Array<{ prompt: string; messages?: Array<{ role: string; content: unknown }> }> = [];
    let dispatchCount = 0;
    const brain = new AgenticTurnBrainClient(registry as any) as any;
    brain.adapter = {
      dispatch: async (opts: { prompt: string; messages?: Array<{ role: string; content: unknown }> }) => {
        dispatches.push(opts);
        dispatchCount++;
        if (dispatchCount === 1) {
          return {
            stdout: '__AGON_TOOL__ {"name":"screenshot","input":{}}',
            stderr: '',
            exitCode: 0,
            timedOut: false,
          };
        }
        return { stdout: 'done', stderr: '', exitCode: 0, timedOut: false };
      },
    };

    await brain.open({ engineId: 'test-engine', cwd: process.cwd() });
    await brain.registerCapability({
      clientId: 'client-1',
      spec: { name: 'screenshot', description: 'Capture screenshot', inputSchema: {}, isReadOnly: true },
    });

    const dataUrl = `data:image/png;base64,${pngFixture(1280, 800).toString('base64')}`;
    const events: unknown[] = [];
    for await (const event of brain.runTurn({ turnId: 'turn-1', clientId: 'client-1', input: 'look at the page' })) {
      events.push(event);
      if (event.kind === 'capability-request') {
        setTimeout(() => {
          void brain.provideCapabilityResult({
            requestId: event.requestId,
            clientId: 'client-1',
            ok: true,
            output: dataUrl,
          });
        }, 0);
      }
    }

    expect(dispatches.length).toBeGreaterThanOrEqual(2);
    const secondPrompt = dispatches[1].prompt;
    expect(secondPrompt).toContain('screenshot captured — 1280x800 px');
    expect(secondPrompt).toContain('these image pixels ARE the coordinate space');
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'tool',
      tool: 'screenshot',
      status: 'done',
      output: expect.stringContaining('1280x800 px'),
    }));
  });
});
