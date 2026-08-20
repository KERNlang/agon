export interface ParsedChunk {
  type: 'text'|'status'|'result'|'raw';
  content: string;
}

/**
 * Buffered NDJSON parser that handles partial JSON lines spanning multiple chunks.
 */
export class StreamParser {
  private buffer: string;

  constructor() {
    this.buffer = '';
  }

  feed(chunk: string): ParsedChunk[] {
    this.buffer += chunk;
    const results: ParsedChunk[] = [];
    const lines = this.buffer.split('\n');
    // Keep the last element — it may be an incomplete line
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      results.push(...this._parseLine(trimmed));
    }
    return results;
  }

  flush(): ParsedChunk[] {
    const results: ParsedChunk[] = [];
    const remaining = this.buffer.trim();
    this.buffer = '';
    if (!remaining) {
      return results;
    }
    results.push(...this._parseLine(remaining));
    return results;
  }

  private _parseLine(line: string): ParsedChunk[] {
    const results: ParsedChunk[] = [];
    try {
      const msg = JSON.parse(line);
      // Primitives (number/string/bool/null) are never streamed content. Skip them here, BEFORE the envelope checks below read msg.type — which would throw on null (JSON.parse('null') === null) and fall into the catch as raw.
      if (msg === null || typeof msg !== 'object') {
        return results;
      }
      // Claude Code stream-json: assistant message with content blocks
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            results.push({ type: 'text', content: block.text });
          }
        }
        return results;
      }
      // Claude Code stream-json: final result
      if (msg.type === 'result') {
        if (msg.result) {
          results.push({ type: 'result', content: (typeof msg.result === 'string') ? msg.result : JSON.stringify(msg.result) });
        }
        if (msg.is_error || msg.error) {
          const errMsg = msg.error ?? msg.result ?? 'Unknown error';
          results.push({ type: 'status', content: (typeof errMsg === 'string') ? errMsg : JSON.stringify(errMsg) });
        }
        return results;
      }
      // Claude Code stream-json: system status
      if (msg.type === 'system') {
        if (msg.message) {
          results.push({ type: 'status', content: msg.message });
        }
        return results;
      }
      // Content vs control (msg is a non-null object or array here). An OBJECT that carries a 'type' key is a (possibly malformed) control envelope we don't recognize — skip it, which covers unknown types AND {type:null}/{type:123}. Arrays (kimi's findings block) and type-less objects are CONTENT — preserve as raw text instead of dropping them (dropping silently ate kimi's findings: the array parsed as JSON, matched no envelope, was discarded, and the accumulated text lost the block while the adapter's raw file still looked complete). KNOWN LIMITATION: a model whose legit text output is a single-line JSON object that happens to carry a 'type' key (e.g. {type:'summary',text:'...'}) is skipped here — same ambiguity class as the original kimi bug, just narrower.
      if (!Array.isArray(msg) && msg.type !== undefined) {
        return results;
      }
      results.push({ type: 'raw', content: line });
      return results;
    } catch (e) {
      // Not JSON: treat as raw text (Codex, Gemini, etc.).
      results.push({ type: 'raw', content: line });
      return results;
    }
  }
}

/**
 * Stateless convenience wrapper. For streaming use, prefer StreamParser.feed() + flush().
 */
export function parseStreamChunk(chunk: string): ParsedChunk[] {
  const parser = new StreamParser();
  const results = parser.feed(chunk);
  results.push(...parser.flush());
  return results;
}

/**
 * A terminal failure reported by a stream-json `result` envelope.
 * `deterministic` marks a failure that WILL recur identically on a retry
 * (the CLI hit a hard-coded budget), as opposed to a transient one
 * (network/tool error) that a second attempt could get past.
 */
export interface StreamJsonFailure {
  subtype: string;
  message: string;
  deterministic: boolean;
}

/**
 * Result subtypes that are a deterministic property of the DISPATCH, not of the
 * moment: re-running the exact same command reproduces them exactly. Retrying one
 * is pure spend with a guaranteed identical outcome, so callers must not.
 */
const DETERMINISTIC_RESULT_SUBTYPES = ['error_max_turns', 'error_max_tokens'];

/**
 * Human-readable cause per deterministic subtype. Kept beside the subtype list so
 * a new terminal reason lands in one place.
 */
function describeResultSubtype(subtype: string): string {
  if (subtype === 'error_max_turns') {
    return 'the CLI used its whole --max-turns budget on tool rounds and never emitted an answer — raise the engine\'s review/exec --max-turns, or make the dispatch non-agentic (engine "nonAgenticFraming")';
  }
  if (subtype === 'error_max_tokens') {
    return 'the CLI hit its output-token cap before emitting an answer';
  }
  return 'the CLI reported an error result';
}

/**
 * Read the TERMINAL stream-json `result` envelope off the tail of a raw stream and
 * describe its failure honestly. This is what turns a silent `exit 1` into
 * "error_max_turns: …" at the call site — the generic exit code carries no cause,
 * so a doomed dispatch used to be indistinguishable from a transient one and got
 * retried at full price.
 *
 * DELIBERATELY NARROW, because a false positive here is expensive in both
 * directions: it fails a review that actually succeeded AND suppresses its retry.
 * Three gates:
 *   1. `streamJson` — the dispatch must actually have run in stream-json output
 *      mode (claude's --output-format stream-json). Every other engine returns
 *      PROSE, and a prose review that quotes a result envelope (reviews of THIS
 *      code do exactly that) is not a failed dispatch.
 *   2. Only the FINAL non-empty line is inspected. In stream-json the terminal
 *      envelope is by definition the last thing on the wire; anything earlier is
 *      either superseded or quoted content. This also subsumes the old
 *      "a later success supersedes an earlier failure" scan.
 *   3. The line must parse WHOLE (not JSON embedded in prose) into a top-level
 *      result envelope: `type === 'result'` plus an envelope-shaped field
 *      (`subtype` string or `is_error` boolean). A bare `{"type":"result"}` inside
 *      someone's example is not enough.
 * Returns null when any gate fails. Tolerant of a truncated tail: an unparseable
 * final line is skipped, not thrown on.
 */
export function parseStreamJsonFailure(raw: string, streamJson: boolean): StreamJsonFailure|null {
  if (!streamJson || !raw || !raw.includes('"result"')) {
    return null;
  }
  const lines = raw.split('\n');
  let last = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed) { last = trimmed; break; }
  }
  if (!last || last.charAt(0) !== '{') {
    return null;
  }
  let msg: any;
  try {
    msg = JSON.parse(last);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || msg.type !== 'result') {
    return null;
  }
  const hasSubtype = typeof msg.subtype === 'string';
  // Envelope shape, not just any object that happens to say type:"result".
  if (!hasSubtype && typeof msg.is_error !== 'boolean') {
    return null;
  }
  const subtype = hasSubtype ? msg.subtype as string : '';
  const isFailure = msg.is_error === true || subtype.startsWith('error');
  if (!isFailure) {
    return null;
  }
  const label = subtype || 'error';
  const detail = typeof msg.error === 'string' && msg.error.trim()
    ? msg.error.trim()
    : (Array.isArray(msg.errors) && msg.errors.length
      ? msg.errors.map((e: any) => (typeof e === 'string' ? e : (e && typeof e.message === 'string' ? e.message : JSON.stringify(e)))).join('; ')
      : describeResultSubtype(subtype));
  return {
    subtype: label,
    message: `${label}: ${detail}`,
    deterministic: DETERMINISTIC_RESULT_SUBTYPES.includes(subtype),
  };
}

/**
 * True when an error message carries a deterministic stream-json result subtype —
 * i.e. the failure is a property of the command, so a retry burns the same spend
 * for the same outcome. Matches on the subtype token the message embeds, so it
 * survives the message being wrapped/prefixed by an intermediate layer.
 */
export function isDeterministicStreamFailure(message: string): boolean {
  if (!message) return false;
  return DETERMINISTIC_RESULT_SUBTYPES.some((s) => message.includes(s));
}
