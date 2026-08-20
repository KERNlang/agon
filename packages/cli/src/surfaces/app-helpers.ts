








// ── Module: AppHelpers ──

export { probeEngineVitals } from './app-telemetry.js';
export { isMutatingToolCall, parseToolCallPayload, toolPreviewWindow, toolCallSupportsDetailView, detailViewerSupportsEvent, toolDetailViewportRows, findLatestToolDetailEvent, findLatestToolEvent, findLatestFailedToolEvent, buildFailedToolRetryDraft, buildToolDetailView } from './app-tool-detail.js';
export { COMPOSER_HISTORY_LIMIT, composerHistoryPath, loadComposerInputHistory, saveComposerInputHistory } from './app-composer.js';
export { maxScrollOffsetForRowCount, nextWheelAnimationStep, clampNumber, charDisplayWidth, stringDisplayWidth, displayColumnToStringIndex } from './app-display-utils.js';
export { normalizeRowSelection, normalizeTextSelection, richLineToPlainText, transcriptRowToPlainText, transcriptRowTextStartColumn, resolveTranscriptColumnFromMouse, transcriptRowsToPlainText, resolveTranscriptRowFromMouse } from './app-selection.js';
export { PLAN_APPROVAL_PROMPT_ROWS, estimateVisibleBlockBudget, estimateWrappedRowCount, estimateQuestionReservedRows, estimateBottomChromeExtraRows, estimatePinnedLiveRows, estimateWrappedRows, estimateToolCallRows, estimateOutputEventRows, estimateDisplayItemRows } from './app-layout.js';
export { buildDisplayItems, isToolCallLikeBlock, coalesceToolCallBlocks, effectiveNativeArchiveBlockCount, historyBlocksForTranscript, nativeTranscriptBlocksForStatic, nativeArchiveBlockCount, isDuplicateEngineBlock, appendTranscriptBlock, buildDashboardBlock, summarizeBtwTranscriptEvent } from './app-blocks.js';
export { createInitialRegistry, drainStdinBuffer, normalizeTerminalMode, resolveTerminalMode, normalizeTerminalSize, fileRailWidthForTerminal, fileRailMaxRowsForTerminal, buildTerminalReplaySnapshot } from './app-terminal.js';
export { parseMarkdownToRows, buildToolCallRows, buildCollapsedToolGroupRows, buildTranscriptRows, buildExecutionRailStats } from './app-rendering.js';
