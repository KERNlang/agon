export * from './types.js';
export * from './errors.js';
export { loadConfig, configGet, configSet, ensureAgonHome, AGON_HOME, ELO_PATH, TEAM_ELO_PATH, CORPUS_PATH, SKILLS_DIR, RUNS_DIR } from './config.js';
export { computeScore, tiebreak, DEFAULT_WEIGHTS } from './scoring.js';
export { updateElo, getElo, getEngineRating } from './elo.js';
export { classifyTask } from './task-classifier.js';
export {
  repoRoot, headSha, worktreePrune, worktreeCreate, worktreeRemove,
  worktreeDiff, readOnlyDiff, diffLineCount, diffFileCount, applyPatch, recentCommits,
  currentBranch, isDirty,
  gitStatusShort, gitDiffStat, gitChangedFiles, gitTruncatedDiff,
} from './git.js';
export { spawnWithTimeout, spawnStream } from './process.js';
export type { SpawnOptions } from './process.js';
export {
  buildForgePrompt, buildCritiquePrompt, buildSynthesisPrompt,
  buildBrainstormPrompt, buildTribunalPrompt, buildReviewPrompt,
} from './prompt-builder.js';
export { createLogger } from './logger.js';
export type { Logger } from './logger.js';
export { EngineRegistry } from './engine-registry.js';
export { scanProjectContext, isKernProject } from './context-scanner.js';
export {
  addWorkspace, removeWorkspace, listWorkspaces,
  getActiveWorkspace, switchWorkspace, getWorkspace,
  ensureCurrentWorkspace, snapshotWorkspace, resolveWorkingDir,
} from './workspace.js';
export type { Workspace, WorkspaceState } from './workspace.js';
export type { ContextFormat } from './context-scanner.js';
export { tracker, estimateTokens, estimateCost } from './token-tracker.js';
export type { TokenUsage, SessionStats } from './token-tracker.js';
export {
  createPlan, advanceStep, canAutoApprove,
  mergeStepResult, approvePlan, startPlan, cancelPlan, failPlan, resetStepForRetry,
} from './plan.js';
export type {
  Plan, PlanStep, PlanStepInput, PlanAction, StepResult, StepAttempt,
  ArtifactRef, WorkspaceSnapshot, PlanState, StepState, StepEffect,
  PlanStepKind, ApprovalLevel,
} from './plan.js';
export { savePlan, loadPlan, listPlans, deletePlan } from './plan-store.js';
export { wordWrap } from './text.js';
export {
  formatSpinnerFrame, formatEngineBlock, formatStatusLine,
  clearLinesSequence, cursorUpSequence, clearLineSequence,
} from './output-manager.js';
export { parseStreamChunk, StreamParser } from './stream-parser.js';
export type { ParsedChunk } from './stream-parser.js';
export { discoverEngines } from './engine-discover.js';
export type { DiscoveryResult } from './engine-discover.js';
export { preflightApply, applyPatchToTree, readPatchFromManifest, readPatchFromPath, applyPatchWithUndo, undoPatch } from './patch-apply.js';
export type { PatchInfo, ApplyPreflight } from './patch-apply.js';
export { parsePatch, patchSummary, invertPatch } from './patch-parser.js';
export type { PatchFile, PatchHunk } from './patch-parser.js';
export { takeSnapshot, revertSnapshot, listSnapshots, getLatestSnapshotId } from './file-history.js';
export type { FileSnapshot, HistoryEntry } from './file-history.js';
export { copyToClipboard } from './clipboard.js';
export { pasteStore, PASTE_MAX_AGE } from './paste-store.js';
export type { PasteStoreResult } from './paste-store.js';
export { saveSessionState, loadSessionState, clearSessionState } from './session-store.js';
// ── Tool System ──
export type { ToolResult, ToolContext, ToolHandler, ToolDefinition, ToolCall, ToolCallResult, PermissionDecision, FileState as ToolFileState } from './tool-types.js';
export { FileStateCache, fileStateCache } from './file-state-cache.js';
export { ToolRegistry, executeToolCall, executeToolCalls } from './tool-registry.js';
export { checkBashPermission, checkFileReadPermission, checkFileWritePermission, isDangerousCommand, isReadOnlyCommand, isPathUnderCwd } from './tool-permissions.js';
export { createReadTool, createEditTool, createWriteTool, createBashTool, createGrepTool, createGlobTool, createForgeTool, createBrainstormTool, createTribunalTool, createCampfireTool, createReportConfidenceTool, createPipelineTool } from './tools.js';
export { generateToolPrompt, toolsToOpenAIFormat } from './generated/tool-prompt.js';
export { parseToolCalls, toolCallsToApiFormat, formatToolResults, formatToolResult } from './generated/tool-parser.js';
export type { ParsedToolCall, ParseResult } from './generated/tool-parser.js';
export { buildToolSystemPrompt, processToolResponse, runToolLoop } from './generated/tool-loop.js';
export type { ToolLoopCallbacks, ToolLoopResult } from './generated/tool-loop.js';
export { startChatSession, appendMessage, loadChatSession, resumeChatSession, listChatSessions, latestChatSession } from './chat-store.js';
export type { ChatMessage as StoredChatMessage, ChatSession } from './chat-store.js';
export {
  isImagePath, mimeFromExt, resolveImagePath,
  buildImageAttachment, extractImagesFromInput,
} from './image.js';
export { logFlow, readFlows, analyzeFlows, FLOWS_DIR, FRICTION_TAGS } from './flow.js';
export type { FlowRecord, FlowTelemetry, FlowFeedback, FlowModeMeta, FlowAnalysis, ModeStats } from './flow.js';
export { apiDispatch, apiStreamDispatch, apiStreamDispatchWithHistory } from './api-dispatch.js';
export type { ApiConfig } from './api-dispatch.js';
export { companionDispatch } from './companion-dispatch.js';
export type { CompanionResult } from './companion-dispatch.js';
export { fetchModelsRegistry, buildModelEntries, searchModels, modelEntryToEngineDef } from './models-registry.js';
export type { ModelEntry, ModelsDevProvider, ModelsDevModel } from './models-registry.js';
export { loadAuthStore, saveAuthStore, setAuthKey, removeAuthKey, getAuthKey, loadAllAuthKeys, listStoredProviders } from './auth-store.js';
export type { AuthEntry, AuthStore } from './auth-store.js';
export {
  createPersistentSession, createCompanionSession, createAcpSession,
  createStreamJsonSession, createResumeSession,
} from './persistent-session.js';
export type {
  PersistentSession, PersistentSessionConfig, SessionChunk, SessionSendOptions,
} from './persistent-session.js';
export { createCesarMemory } from './generated/cesar-memory.js';
export type { CesarMemory, MemoryEntry } from './generated/cesar-memory.js';
export { runHooks, hooksFailed, hooksOutput } from './hooks.js';
export type { HookEvent, HookDef, HookResult } from './hooks.js';
export { loadSkills, findSkill, renderSkillPrompt } from './skill-loader.js';
export {
  loadEngineMemory, addEngineNote, setEngineStrengths, setEngineWeaknesses,
  addEngineTendency, getEngineProfile, buildRolePrompt, recordForgeOutcome,
} from './engine-memory.js';
export type { EngineNote, EngineProfile, EngineMemoryRecord } from './engine-memory.js';
export { rankByTaskClass, buildSpecializedPrompt, assignForgeRoles } from './role-specialization.js';
export type { EngineRole } from './role-specialization.js';
export type { Skill } from './skill-loader.js';
export { createSidechainLogger } from './sidechain-logger.js';
export type { SidechainEvent, SidechainLogger } from './sidechain-logger.js';
export { validateEngineConfig, validateEngineDir, EngineDefinitionSchema } from './schemas/engine-schema.js';
export type { ValidatedEngineDefinition } from './schemas/engine-schema.js';
export { sessionContext } from './session-context.js';
export {
  splitPromptBlocks, mergeBlocksByRole,
} from './prompt-builder.js';
export type { PromptBlock } from './prompt-builder.js';
// ── Team Competition ──
export {
  lineupKey, makeFormat, assignTeamRoles, composeTeams, computeContributionWeights,
} from './generated/team.js';
export type {
  TeamRole, TeamComposeMode, TeamCoopStrategy, TeamMember, TeamSpec, TeamFormat,
  TeamRoundTrace, TeamSubmission, TeamScoreCard, TeamMatchResult, TeamEvent,
} from './generated/team.js';
export { getTeamElo, updateTeamElo, predictTeamRating } from './generated/team-elo.js';
export type { TeamCompositionRating, TeamRoleRating, TeamEloRecord } from './generated/team-elo.js';
