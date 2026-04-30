import { describe, it, expect, vi } from 'vitest';
import { runToolLoop } from '../../packages/core/src/generated/tools/tool-loop.js';
import { ToolRegistry } from '../../packages/core/src/generated/signals/tool-registry.js';

describe('tool loop orchestration stops', () => {
  it('stops before executing or reinjecting a ProposePlan XML tool call', async () => {
    const registry = new ToolRegistry();
    const sendMessage = vi.fn(async () => 'should not be requested');
    const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const toolResults: string[] = [];

    const result = await runToolLoop(
      sendMessage,
      'Plan ready.\n<tool name="ProposePlan">{"steps":[]}</tool>',
      { cwd: process.cwd(), readFileState: new Map() } as any,
      registry,
      {
        onToolCall: (name, input) => toolCalls.push({ name, input }),
        onToolResult: (name) => toolResults.push(name),
        shouldStopAfterToolCall: (name) => name === 'ProposePlan',
      },
    );

    expect(toolCalls).toEqual([{ name: 'ProposePlan', input: { steps: [] } }]);
    expect(toolResults).toEqual([]);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.finalText).toBe('Plan ready.');
    expect(result.toolCallCount).toBe(1);
    expect(result.aborted).toBe(false);
  });
});
