import { describe, expect, it, vi } from 'vitest';
import { createFollowUpDisplay } from '../../packages/cli/src/cesar/follow-up-display.js';

function fixture() {
  const onChunk = vi.fn<(text: string) => void>();
  const onEnd = vi.fn<() => void>();
  const display = createFollowUpDisplay({ onChunk, onEnd });
  return { display, onChunk, onEnd, text: () => onChunk.mock.calls.map(([text]) => text).join('') };
}

describe('follow-up display boundary', () => {
  it('flushes held prose and closes the stream exactly once', () => {
    const { display, onChunk, onEnd } = fixture();
    display.push('Short answer.');
    expect(onChunk).not.toHaveBeenCalled();
    display.end({ flush: true });
    display.end({ flush: true });
    expect(onChunk.mock.calls).toEqual([['Short answer.']]);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('streams long prose before completion and preserves the final tail', () => {
    const { display, onChunk, onEnd, text } = fixture();
    const answer = 'This answer is long enough to start rendering before the stream ends.';
    for (const char of answer) display.push(char);
    expect(onChunk).toHaveBeenCalled();
    expect(text()).toBe(answer.slice(0, -24));
    display.end({ flush: true });
    expect(text()).toBe(answer);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it.each(['', 'Short answer.', 'Long visible answer with a buffered tail that must stay hidden.'])(
    'does not flush refused output: %j', answer => {
      const { display, onEnd, text } = fixture();
      display.push(answer);
      const alreadyVisible = text();
      display.end({ flush: false });
      display.end({ flush: false });
      expect(text()).toBe(alreadyVisible);
      expect(onEnd).toHaveBeenCalledTimes(alreadyVisible ? 1 : 0);
    },
  );

  it('does not open or close an empty stream', () => {
    const { display, onChunk, onEnd } = fixture();
    display.end({ flush: true });
    display.end({ flush: true });
    expect(onChunk).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('can render a later response without repeating the earlier response', () => {
    const { display, onChunk, onEnd } = fixture();
    display.push('First.');
    display.end({ flush: true });
    display.push('Second.');
    display.end({ flush: true });
    display.end({ flush: true });
    expect(onChunk.mock.calls).toEqual([['First.'], ['Second.']]);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it.each([
    '<tool name="Read">{"file_path":"a.ts"}</tool>',
    '[TOOL_CALLS][{"name":"Read","arguments":{"file_path":"a.ts"}}]',
    '<tool_call_tool>{"name":"Read","arguments":{}}</tool_call_tool>',
  ])('preserves preceding prose and suppresses tool markup at every split: %s', tool => {
    const answer = `Reading the file.\n${tool} done.`;
    for (let split = 0; split <= answer.length; split++) {
      const { display, text, onEnd } = fixture();
      display.push(answer.slice(0, split));
      display.push(answer.slice(split));
      display.end({ flush: true });
      expect(text(), `split ${split}`).toBe('Reading the file.\n');
      expect(onEnd).toHaveBeenCalledOnce();
    }
  });

  it('never opens a visible stream for a pure tool call', () => {
    const { display, onChunk, onEnd } = fixture();
    for (const part of ['<tool name=', '"Read">{"file_path"', ':"a.ts"}</tool>']) display.push(part);
    display.end({ flush: true });
    expect(onChunk).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it.each(['ASK', 'TODOS'])('strips %s blocks before tool detection at every split', marker => {
    const answer = `Before.[${marker}]{"text":"choose"}[/${marker}]After.`;
    for (let split = 0; split <= answer.length; split++) {
      const { display, text } = fixture();
      display.push(answer.slice(0, split));
      display.push(answer.slice(split));
      display.end({ flush: true });
      expect(text(), `split ${split}`).toBe('Before.After.');
    }
  });

  it('shares marker state with the non-streamed completion sink', () => {
    const { display, text } = fixture();
    display.push('Before.[AS');
    expect(display.stripMarkers('K]{"question":"Choose?"}[/ASK]After.[TO')).toBe('After.');
    expect(display.stripMarkers('', true)).toBe('[TO');
    expect(display.stripMarkers('', true)).toBe('');
    display.end({ flush: true });
    expect(text()).toBe('Before.');
  });
});
