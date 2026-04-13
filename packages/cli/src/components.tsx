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

// Status
export {
  SpinnerBlock, TokenGauge, StatusBar, StatusLine, BackgroundJobRail,
  CesarStatusStrip, AGON_TIPS,
} from './generated/surfaces/status.js';

// Re-export ENGINE_COLORS from output for backward compat
export { ENGINE_COLORS } from './output.js';

// Memoized TextInput — ink-text-input ships unmemoized, so any parent
// re-render forces TextInput to reconcile against stdin. While Cesar streams,
// the App component re-renders ~11x/sec (throttle=90 streamingText), which
// fights with stdin character delivery and produces dropped/reordered keys
// in the composer. React.memo + stable handler refs (useCallback in
// app.kern) lets the composer stay still while streaming runs.
import React from 'react';
import RawTextInput from 'ink-text-input';
export const MemoTextInput = React.memo(RawTextInput);
