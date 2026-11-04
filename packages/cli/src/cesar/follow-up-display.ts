import {
  chunkMayCompleteToolCall,
  createAskDisplayStripper,
  createTodosDisplayStripper,
  splitBeforeToolMarkup,
  textHasToolCalls,
  XML_TOOL_MARKUP_HOLD_CHARS,
} from './brain-helpers.js';

interface FollowUpDisplaySink {
  onChunk: (text: string) => void;
  onEnd: () => void;
}

/** One interactive continuation's display state; no session or tool execution. */
export function createFollowUpDisplay(sink: FollowUpDisplaySink) {
  const stripTodos = createTodosDisplayStripper();
  const stripAsk = createAskDisplayStripper();
  let suppressTools = false;
  let hold = '';
  let streaming = false;
  let toolTail = '';
  let scanPending = false;
  let rawText = '';

  // Shared with the non-streamed completion sink: marker state must not reset
  // between live chunks, completion text and the final partial-marker flush.
  const stripMarkers = (text: string, force = false): string =>
    stripAsk(stripTodos(text, force), force);

  const displayChunk = (text: string, force: boolean): string => {
    if (suppressTools) { hold = ''; return ''; }
    const combined = hold + text;
    const split = splitBeforeToolMarkup(combined);
    if (split.hasToolMarkup) { suppressTools = true; hold = ''; return split.visible; }
    // Split first to retain preceding prose. Other textual formats use the
    // executor's predicate over raw text, regardless of native-tool support.
    if (scanPending) {
      scanPending = false;
      if (textHasToolCalls(rawText)) { suppressTools = true; hold = ''; return ''; }
    }
    if (force) { hold = ''; return combined; }
    const held = Math.min(XML_TOOL_MARKUP_HOLD_CHARS, combined.length);
    const visible = combined.slice(0, combined.length - held);
    hold = combined.slice(combined.length - held);
    return visible;
  };

  const emit = (raw: string, force = false): void => {
    rawText += raw;
    // Advance the cheap scan gate even when the marker strippers swallow a
    // whole chunk. Do not parse the growing raw buffer on every prose chunk.
    const gate = chunkMayCompleteToolCall(toolTail, raw);
    toolTail = gate.tail;
    if (gate.scan) scanPending = true;
    const stripped = stripMarkers(raw, force);
    // A force flush must reach the tool gate even when marker stripping emits
    // nothing: the gate can still hold the entire answer or its final 24 chars.
    if (!stripped && !force) return;
    const visible = displayChunk(stripped, force);
    if (!visible) return;
    streaming = true;
    sink.onChunk(visible);
  };

  return {
    push: (raw: string): void => emit(raw),
    stripMarkers,
    // The caller owns health policy. Refused cleanup must not release held
    // text, but must still close an already visible stream. Repeated end calls
    // are harmless; a later model response may start another visible stream.
    end({ flush }: { flush: boolean }): void {
      if (flush) emit('', true);
      if (streaming) {
        sink.onEnd();
        streaming = false;
      }
    },
  };
}
