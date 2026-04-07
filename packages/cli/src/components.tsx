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
} from './generated/ui-rendering.js';
export type { SyntaxToken } from './generated/ui-rendering.js';

// Engine display
export {
  EngineProgressView, EngineBlock, ConversationalResponse,
  OutputBlockView, ToolCallGroup,
  BRAND, LOGO_LINES, VERSION,
} from './generated/ui-engine.js';
export type { OutputBlock } from './generated/ui-engine.js';

// Controls
export {
  SlashPicker, EnginePicker, ModelPicker, ReviewBlock, CesarPicker,
} from './generated/ui-controls.js';
export type { ReviewEvent, ModelPickerEntry } from './generated/ui-controls.js';

// Status
export {
  SpinnerBlock, TokenGauge, StatusBar, StatusLine, BackgroundJobRail,
  AGON_TIPS,
} from './generated/ui-status.js';

// Re-export ENGINE_COLORS from output for backward compat
export { ENGINE_COLORS } from './output.js';
