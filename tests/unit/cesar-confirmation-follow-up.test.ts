import { describe, expect, it, vi } from 'vitest';

import {
  runCesarConfirmationFollowUp,
} from '../../packages/cli/src/generated/cesar/confirmation-follow-up.js';
import { hostWaitForInteractiveChoice } from '../../packages/cli/src/generated/lib/kern-host.js';

describe('runCesarConfirmationFollowUp', () => {
  it('executes tool markup returned after Yes instead of rendering raw XML as a completed answer', async () => {
    const send = vi.fn(async () => '<tool name="Read">{"file_path":"brain.kern"}</tool>');
    const executeTools = vi.fn(async () => ({ finalText: 'Plan ready.', turns: 2 }));
    const onText = vi.fn();

    const result = await runCesarConfirmationFollowUp({
      answer: 'y',
      send,
      executeTools,
      onText,
    });

    expect(send).toHaveBeenCalledWith('yes');
    expect(executeTools).toHaveBeenCalledWith('<tool name="Read">{"file_path":"brain.kern"}</tool>');
    expect(onText).toHaveBeenCalledWith('Plan ready.');
    expect(result).toEqual({
      status: 'tools',
      content: 'Plan ready.',
      turns: 2,
      raw: '<tool name="Read">{"file_path":"brain.kern"}</tool>',
    });
  });

  it('reports the authoritative follow-up exchange after tool execution so callers can persist it', async () => {
    const onExchange = vi.fn();
    const result = await runCesarConfirmationFollowUp({
      answer: 'y',
      send: async () => '<tool name="Read">{"file_path":"brain.kern"}</tool>',
      executeTools: async () => ({ finalText: 'Finished after reading.', turns: 1 }),
      onExchange,
    });

    expect(onExchange).toHaveBeenCalledOnce();
    expect(onExchange).toHaveBeenCalledWith('yes', result);
  });

  it('does not render final tool-loop text twice when the executor already rendered it', async () => {
    const onText = vi.fn();
    const result = await runCesarConfirmationFollowUp({
      answer: 'y',
      send: async () => '<tool name="Read">{"file_path":"brain.kern"}</tool>',
      executeTools: async () => ({ finalText: 'Already rendered.', turns: 1, rendered: true }),
      onText,
    });

    expect(result.content).toBe('Already rendered.');
    expect(onText).not.toHaveBeenCalled();
  });

  it('reports an empty attempted exchange without fabricating an engine response', async () => {
    const onExchange = vi.fn();
    const result = await runCesarConfirmationFollowUp({
      answer: 'y',
      send: async () => '',
      onExchange,
    });

    expect(result.status).toBe('empty');
    expect(onExchange).toHaveBeenCalledWith('yes', result);
  });

  it('keeps ordinary text follow-ups visible and authoritative', async () => {
    const onText = vi.fn();
    const result = await runCesarConfirmationFollowUp({
      answer: 'y',
      send: async () => 'Proceeding with the scoped plan.',
      executeTools: async () => ({ finalText: '', turns: 0 }),
      onText,
    });

    expect(onText).toHaveBeenCalledWith('Proceeding with the scoped plan.');
    expect(result.status).toBe('text');
    expect(result.content).toBe('Proceeding with the scoped plan.');
  });

  it('does not send a follow-up when the user declines', async () => {
    const send = vi.fn(async () => 'should not run');
    const result = await runCesarConfirmationFollowUp({
      answer: 'n',
      send,
      executeTools: async () => ({ finalText: '', turns: 0 }),
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.status).toBe('declined');
  });

  it('uses the selected option instruction instead of hardcoding Yes', async () => {
    const send = vi.fn(async () => 'Option B completed.');

    const result = await runCesarConfirmationFollowUp({
      answer: 'b',
      message: 'Go with option B: split the module. Proceed and finish it.',
      send,
    });

    expect(send).toHaveBeenCalledWith('Go with option B: split the module. Proceed and finish it.');
    expect(result.status).toBe('text');
    expect(result.content).toBe('Option B completed.');
  });

  it('surfaces an engine error instead of converting it into an empty success', async () => {
    const onExchange = vi.fn();
    const result = await runCesarConfirmationFollowUp({
      answer: 'y',
      send: async () => ({ text: '', error: 'provider stream failed' }),
      onExchange,
    });

    expect(result.status).toBe('error');
    expect(result.error).toBe('provider stream failed');
    expect(onExchange).toHaveBeenCalledWith('yes', result);
  });

  it('keeps safe partial prose visible while marking a stream error incomplete', async () => {
    const onText = vi.fn();
    const result = await runCesarConfirmationFollowUp({
      answer: 'y',
      send: async () => ({ text: 'I inspected the branch.', error: 'stream disconnected' }),
      onText,
    });

    expect(result.status).toBe('error');
    expect(result.content).toBe('I inspected the branch.');
    expect(onText).toHaveBeenCalledWith('I inspected the branch.');
  });

  it('turns a tool-loop transport failure into an explicit follow-up error', async () => {
    const result = await runCesarConfirmationFollowUp({
      answer: 'y',
      send: async () => '<tool name="Read">{"file_path":"brain.kern"}</tool>',
      executeTools: async () => { throw new Error('continuation stream failed'); },
    });

    expect(result.status).toBe('error');
    expect(result.error).toBe('continuation stream failed');
    expect(result.content).toBe('');
  });
});

describe('hostWaitForInteractiveChoice', () => {
  it('returns the selected answer and detaches the abort listener', async () => {
    const abort = new AbortController();
    let resolveChoice: ((answer: string) => void) | undefined;
    const pending = hostWaitForInteractiveChoice(abort.signal, (resolve) => { resolveChoice = resolve; });

    resolveChoice?.('y');

    await expect(pending).resolves.toBe('y');
    abort.abort();
  });

  it('settles with an empty answer when the turn is aborted externally', async () => {
    const abort = new AbortController();
    const pending = hostWaitForInteractiveChoice(abort.signal, () => {});

    abort.abort();

    await expect(pending).resolves.toBe('');
  });
});
