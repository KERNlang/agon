// ── Components — KERN-sourced facade ─────────────────────────────────
// Source of truth: kern/ui-rendering.kern, ui-engine.kern, ui-controls.kern, ui-status.kern
// This file re-exports for backward compatibility with app.tsx imports.

// Rendering primitives
export {
  contentWidth, color256toHex, engineColor, tokenizeLine,
  DiffLine, SyntaxLine, CodeBlockView, RichSpanView, RichLineView,
  MarkdownTableView, RenderedSegments, GradientLine, AnsiLine,
  CODE_RAIL, CODE_RAIL_COLOR, MAX_CODE_LINES,
  SYN_KEYWORD, SYN_STRING, SYN_COMMENT, SYN_NUMBER, SYN_TYPE, SYN_PUNCT, SYN_FN,
  KEYWORDS, TYPES,
} from './generated/blocks/rendering.js';
export type { SyntaxToken } from './generated/blocks/rendering.js';

// Engine display
export {
  EngineProgressView, EngineBlock, ConversationalResponse,
  OutputBlockView, ToolCallGroup, DebateGroup, BidGroup,
  BRAND, LOGO_LINES, VERSION,
} from './generated/blocks/engine.js';
export type { OutputBlock } from './generated/blocks/engine.js';

// Controls
export {
  SlashPicker, EnginePicker, ModelPicker, ReviewBlock, CesarPicker,
} from './generated/blocks/controls.js';
export type { ReviewEvent, ModelPickerEntry } from './generated/blocks/controls.js';

// Composer (memoized) — extracted from app.kern so streaming-driven re-renders
// don't reach the TextInput. See blocks/composer.kern.
export { ComposerView } from './generated/blocks/composer.js';

// Status — BackgroundJobRail and CesarStatusStrip are React.memo-wrapped here
// because kern-lang 3.1.7 honors `memo=true` on block screens only, not on
// surface screens that use `export=named` or top-level `export function`.
// See status.kern for the KERN-GAP note.
//
// StatusBar is intentionally NOT memoized: its render reads global mutable
// state (tracker.getStats(), chatSession.messages.length, resolveWorkingDir(),
// currentBranch()) that is not passed in as props. Shallow-equal would make
// the bar go stale on quiet renders. If StatusBar becomes a measurable perf
// hotspot, hoist those reads into props on App and then memoize.
import * as _Status from './generated/surfaces/status.js';
import { memo as _reactMemo } from 'react';
export const StatusBar = _Status.StatusBar;
export const BackgroundJobRail = _reactMemo(_Status.BackgroundJobRail);
export const CesarStatusStrip = _reactMemo(_Status.CesarStatusStrip);
export const SpinnerBlock = _Status.SpinnerBlock;
export const TokenGauge = _Status.TokenGauge;
export const StatusLine = _Status.StatusLine;
export const AGON_TIPS = _Status.AGON_TIPS;

// Re-export ENGINE_COLORS from output for backward compat
export { ENGINE_COLORS } from './output.js';

// MemoTextInput — alias to SafeTextInput, our React.memo'd fork of
// ink-text-input that drops Ctrl-modified keystrokes at the source so they
// don't leak into the composer. See safe-text-input.tsx for the rationale.
export { SafeTextInput as MemoTextInput } from './safe-text-input.js';
