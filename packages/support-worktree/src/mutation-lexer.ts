export interface QuoteSpec {
  readonly open: string;
  readonly close: string;
  readonly escape: boolean;
  readonly multiline: boolean;
}

/**
 * Comment and literal syntax for one language family. `quotes` are tried in order, so longer openers (`"""`) must precede their prefixes (`"`). `rustLiterals` enables raw strings (`r#"…"#`) and the char-vs-lifetime rule; `cfgTestItems` drops `#[cfg(test)]` items from the target pool.
 */
export interface LexerSyntax {
  readonly lineComments: readonly string[];
  readonly blockComment?: { readonly open: string; readonly close: string; readonly nested: boolean };
  readonly quotes: readonly QuoteSpec[];
  readonly rustLiterals?: boolean;
  readonly cfgTestItems?: boolean;
}

/**
 * Per-line classification: `code` holds the [start, end) column spans that are executable code (outside comments and string/char literals); `skip` marks lines that must never be mutated (e.g. inside a Rust test-only item).
 */
export interface LexedLine {
  readonly code: ReadonlyArray<readonly [number, number]>;
  readonly skip: boolean;
}

type LexState =
  | { readonly kind: 'code' }
  | { readonly kind: 'block'; readonly depth: number }
  | { readonly kind: 'string'; readonly quote: QuoteSpec };

const CODE: LexState = { kind: 'code' };
const RUST_CHAR = /^'(?:\\(?:u\{[0-9a-fA-F]{1,6}\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/;
const RUST_RAW = /^b?r(#*)"/;
const CFG_TEST = /^#\[\s*cfg\s*\(\s*test\s*\)\s*\]/;

function lexLine(text: string, syntax: LexerSyntax, start: LexState): { spans: Array<[number, number]>; end: LexState } {
  const spans: Array<[number, number]> = [];
  let state = start;
  let codeStart = state.kind === 'code' ? 0 : -1;
  const closeCode = (at: number): void => {
    if (codeStart >= 0 && at > codeStart) spans.push([codeStart, at]);
    codeStart = -1;
  };
  let i = 0;
  scan: while (i < text.length) {
    if (state.kind === 'block') {
      const block = syntax.blockComment!;
      if (block.nested && text.startsWith(block.open, i)) { state = { kind: 'block', depth: state.depth + 1 }; i += block.open.length; continue; }
      if (text.startsWith(block.close, i)) {
        i += block.close.length;
        state = state.depth > 1 ? { kind: 'block', depth: state.depth - 1 } : CODE;
        if (state.kind === 'code') codeStart = i;
        continue;
      }
      i += 1;
      continue;
    }
    if (state.kind === 'string') {
      const { quote } = state;
      if (quote.escape && text[i] === '\\') { i += 2; continue; }
      if (text.startsWith(quote.close, i)) { i += quote.close.length; state = CODE; codeStart = i; continue; }
      i += 1;
      continue;
    }
    for (const marker of syntax.lineComments) {
      if (text.startsWith(marker, i)) { closeCode(i); break scan; }
    }
    if (syntax.blockComment && text.startsWith(syntax.blockComment.open, i)) {
      closeCode(i);
      state = { kind: 'block', depth: 1 };
      i += syntax.blockComment.open.length;
      continue;
    }
    if (syntax.rustLiterals) {
      const prev = i > 0 ? text[i - 1] : '';
      if (text[i] === "'") {
        const char = RUST_CHAR.exec(text.slice(i));
        if (char) { closeCode(i); i += char[0].length; codeStart = i; continue; }
        i += 1;
        continue;
      }
      const raw = (text[i] === 'r' || text[i] === 'b') && !/\w/.test(prev) ? RUST_RAW.exec(text.slice(i)) : null;
      if (raw) {
        closeCode(i);
        state = { kind: 'string', quote: { open: raw[0], close: `"${raw[1]}`, escape: false, multiline: true } };
        i += raw[0].length;
        continue;
      }
    }
    const quote = syntax.quotes.find(q => text.startsWith(q.open, i));
    if (quote) {
      closeCode(i);
      state = { kind: 'string', quote };
      i += quote.open.length;
      continue;
    }
    i += 1;
  }
  if (state.kind === 'code') closeCode(text.length);
  if (state.kind === 'string' && !state.quote.multiline) state = CODE;
  return { spans, end: state };
}

/**
 * Replace every character outside the given code spans with NUL, keeping column positions, so operator patterns can only match executable code.
 */
export function maskToCode(line: string, code: ReadonlyArray<readonly [number, number]>): string {
  const chars = Array.from({ length: line.length }, () => '\0');
  for (const [from, to] of code) for (let i = from; i < to && i < line.length; i += 1) chars[i] = line[i];
  return chars.join('');
}

function markCfgTestItems(lines: readonly string[], lexed: Array<{ code: Array<[number, number]>; skip: boolean }>): void {
  let active = false;
  let depth = 0;
  let opened = false;
  let nesting = 0;
  for (let n = 0; n < lines.length; n += 1) {
    const masked = maskToCode(lines[n], lexed[n].code);
    let from = 0;
    if (!active) {
      const lead = masked.length - masked.trimStart().length;
      const attr = CFG_TEST.exec(masked.slice(lead));
      if (!attr) continue;
      active = true;
      depth = 0;
      nesting = 0;
      opened = false;
      from = lead + attr[0].length;
    }
    lexed[n].skip = true;
    for (let i = from; i < masked.length; i += 1) {
      const ch = masked[i];
      if (ch === '{') { depth += 1; opened = true; }
      else if (ch === '}') depth -= 1;
      else if (ch === '(' || ch === '[') nesting += 1;
      else if (ch === ')' || ch === ']') nesting -= 1;
      else if (ch === ';' && !opened && depth === 0 && nesting === 0) { active = false; break; }
      if (opened && depth === 0) { active = false; break; }
    }
  }
}

/**
 * Classify every line of `source` (split on `\n`; a trailing `\r` is never code) under the given syntax, carrying block-comment and multi-line string state across lines.
 */
export function lexSource(source: string, syntax: LexerSyntax): LexedLine[] {
  const lines = String(source ?? '').split('\n');
  const out: Array<{ code: Array<[number, number]>; skip: boolean }> = [];
  let state: LexState = CODE;
  for (const raw of lines) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const { spans, end } = lexLine(text, syntax, state);
    state = end;
    out.push({ code: spans.filter(([from, to]) => text.slice(from, to).trim().length > 0), skip: false });
  }
  if (syntax.cfgTestItems) markCfgTestItems(lines, out);
  return out;
}
