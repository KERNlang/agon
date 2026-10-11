/** Settings owned by @kernlang/agon-kernel. */
export interface KernelSettings {
  debug?: boolean;
  timeout?: number;
  forgeTimeout?: number;
  forgeAutoAcceptScore?: number;
  forgeClearWinnerSpread?: number;
  forgeMaxCritiques?: number;
  forgeStarterStrategy?: 'fixed'|'rotate';
  forgeFixedStarter?: string;
  forgeRequireBaselineCheck?: boolean;
  forgeEarlyFinalizeEnabled?: boolean;
  forgeEarlyFinalizePassingCount?: number;
  forgeEarlyFinalizeMinScore?: number;
  forgeHealthCheckEnabled?: boolean;
  forgeHealthCheckTimeoutSec?: number;
  forgeHealthCheckApiTimeoutSec?: number;
  forgeMaxParallelApi?: number;
  reviewMaxTokens?: number;
  reviewFileContext?: boolean;
  ratingsEnabled?: boolean;
  contextSummary?: boolean;
  onboarded?: boolean;
  projectContext?: string;
  contextFormat?: 'plain'|'kern';
  approvalLevel?: 'plan'|'task'|'write'|'none';
  agentTimeout?: number;
  agentPermissionLevel?: 'full'|'plan'|'read-only';
  jobEventLimit?: number;
  jobRetentionLimit?: number;
  jobMaxConcurrency?: number;
  jobLabelMaxChars?: number;
  jobOutputChunkChars?: number;
  jobCancelGraceMs?: number;
  jobShutdownTimeoutMs?: number;
  daemonFrameMaxBytes?: number;
  gauntletEnabled?: boolean;
  gauntletMaxBreakers?: number;
  gauntletRepairTimeout?: number;
  corpusReplayLimit?: number;
  cesarEnabled?: boolean;
  cesarScoutCount?: number;
  cesarScoutTimeout?: number;
  cesarDisagreementSpread?: number;
  cesarAutoPipeline?: boolean;
  cesarPipelineThreshold?: number;
  cesarBackend?: 'cli'|'api'|'auto';
  claudeBackend?: 'print'|'pty';
  cesarActingFallback?: 'ask'|'auto'|'off';
  cesarMcpEnabled?: boolean;
  cesarAutoApproveMode?: 'off'|'safe-only'|'cost-bounded'|'always';
  cesarAutoApproveMaxCostUsd: number;
  cesarAutoMode?: boolean;
  cesarAutoHarnessProfile?: 'legacy'|'agentic';
  cesarImportantTaskPattern: string;
  cesarDangerousTaskPattern: string;
  cesarDestructiveActionPattern: string;
  cesarAutoModePrompted?: boolean;
  resumePausedPlanOnStartup?: boolean;
  cesarSelfTurnAutoApprove?: boolean;
  cesarSelfTurnAutoApproveMaxDiffTokens?: number;
  cesarToolTimeline?: boolean;
  protectedPushBranches: string[];
  cesarExperience?: boolean;
  cesarExperienceMinSimilarity: number;
  cesarExperienceMinEpisodes: number;
  cesarExperienceTopK: number;
  cesarExperienceWindow: number;
  cesarDelegationReflex?: boolean;
  cesarGateAutoRun?: boolean;
  cesarGateAutoRunLimit?: number;
  cesarGateTimeoutSec?: number;
  cesarGateOutputTailChars?: number;
  cesarSearchNudgeThreshold: number;
  cesarReadSpiralThreshold: number;
  cesarReadRepeatThreshold: number;
  cesarStreamingXmlTools?: boolean;
  campfireObserverStrategy?: 'lead-first'|'all-respond';
  hooks: Record<string,Array<{command:string,engines?:string[],matcher?:string,timeout?:number}>>;
  permissionMode?: 'auto'|'smart'|'ask'|'deny-all';
  agonPermissionMode: string;
  allowedCommands: string[];
  toolPermissions: Record<string,'allow'|'ask'|'deny'>;
  permissions: {allow?:string[],deny?:string[]};
  terminalMode?: 'auto'|'native'|'fullscreen';
  uiMotion?: 'full'|'reduced'|'off';
  statusLine?: string;
  iconTheme?: 'roman'|'classic';
  narrationFold?: 'off'|'safe'|'aggressive';
  buddyTimeout?: number;
  speculativeThresholdUsd?: number;
  speculativeEloSpreadThreshold?: number;
  neroExplorationRate?: number;
  autoCredit?: boolean;
}

export const DEFAULT_KERNEL_SETTINGS: Required<KernelSettings> = {
  debug: false,
  timeout: 360,
  forgeTimeout: 1800,
  forgeAutoAcceptScore: 88,
  forgeClearWinnerSpread: 8,
  forgeMaxCritiques: 3,
  forgeStarterStrategy: 'fixed',
  forgeFixedStarter: 'claude',
  forgeRequireBaselineCheck: true,
  forgeEarlyFinalizeEnabled: true,
  forgeEarlyFinalizePassingCount: 3,
  forgeEarlyFinalizeMinScore: 70,
  forgeHealthCheckEnabled: true,
  forgeHealthCheckTimeoutSec: 20,
  forgeHealthCheckApiTimeoutSec: 45,
  forgeMaxParallelApi: 2,
  reviewMaxTokens: 0,
  reviewFileContext: true,
  ratingsEnabled: true,
  contextSummary: true,
  onboarded: false,
  projectContext: '',
  contextFormat: 'plain',
  approvalLevel: 'plan',
  agentTimeout: 600,
  agentPermissionLevel: 'full',
  jobEventLimit: 256,
  jobRetentionLimit: 100,
  jobMaxConcurrency: 4,
  jobLabelMaxChars: 120,
  jobOutputChunkChars: 16000,
  jobCancelGraceMs: 2000,
  jobShutdownTimeoutMs: 10000,
  daemonFrameMaxBytes: 1048576,
  gauntletEnabled: false,
  gauntletMaxBreakers: 3,
  gauntletRepairTimeout: 300,
  corpusReplayLimit: 5,
  cesarEnabled: true,
  cesarScoutCount: 2,
  cesarScoutTimeout: 18,
  cesarDisagreementSpread: 20,
  cesarAutoPipeline: false,
  cesarPipelineThreshold: 93,
  cesarBackend: 'auto',
  claudeBackend: 'print',
  cesarActingFallback: 'auto',
  cesarMcpEnabled: false,
  cesarAutoApproveMode: 'safe-only',
  cesarAutoApproveMaxCostUsd: 0,
  cesarAutoMode: false,
  cesarAutoHarnessProfile: 'agentic',
  cesarImportantTaskPattern: '',
  cesarDangerousTaskPattern: '',
  cesarDestructiveActionPattern: '',
  cesarAutoModePrompted: false,
  resumePausedPlanOnStartup: false,
  cesarSelfTurnAutoApprove: true,
  cesarSelfTurnAutoApproveMaxDiffTokens: 1200,
  cesarToolTimeline: true,
  protectedPushBranches: [],
  cesarExperience: true,
  cesarExperienceMinSimilarity: 0,
  cesarExperienceMinEpisodes: 0,
  cesarExperienceTopK: 0,
  cesarExperienceWindow: 0,
  cesarDelegationReflex: true,
  cesarGateAutoRun: true,
  cesarGateAutoRunLimit: 3,
  cesarGateTimeoutSec: 300,
  cesarGateOutputTailChars: 2000,
  cesarSearchNudgeThreshold: 0,
  cesarReadSpiralThreshold: 0,
  cesarReadRepeatThreshold: 0,
  cesarStreamingXmlTools: true,
  campfireObserverStrategy: 'lead-first',
  hooks: {} as any,
  permissionMode: 'smart',
  agonPermissionMode: '',
  allowedCommands: [],
  toolPermissions: {} as any,
  permissions: {} as any,
  terminalMode: 'auto',
  uiMotion: 'reduced',
  statusLine: '',
  iconTheme: 'roman',
  narrationFold: 'safe',
  buddyTimeout: 420,
  speculativeThresholdUsd: 0.50,
  speculativeEloSpreadThreshold: 15,
  neroExplorationRate: 0.2,
  autoCredit: true,
};

/** Preserve normalization and permission aggregation across the three scopes. */
export function normalizeKernelSettings(
  merged: KernelSettings,
  global: Partial<KernelSettings>,
  local: Partial<KernelSettings>,
  localPrivate: Partial<KernelSettings>,
): void {
  if (!['auto', 'native', 'fullscreen'].includes(String(merged.terminalMode))) merged.terminalMode = 'auto';
  if (!['full', 'reduced', 'off'].includes(String((merged as any).uiMotion))) (merged as any).uiMotion = 'reduced';
  if (!merged.hooks || typeof merged.hooks === 'string') (merged as any).hooks = {};
  if (!merged.allowedCommands || typeof merged.allowedCommands === 'string') (merged as any).allowedCommands = [];
  // Default tool permissions — same model as Claude Code:
  // Read/search = auto-allow, Write/Edit/Bash = ask
  if (!merged.toolPermissions || typeof merged.toolPermissions === 'string') {
    (merged as any).toolPermissions = {
      Read: 'allow',
      Grep: 'allow',
      Glob: 'allow',
      Edit: 'ask',
      Write: 'ask',
      Bash: 'ask',
    };
  }
  if (!(merged as any).permissionMode) (merged as any).permissionMode = 'smart';
  // CC-parity permissions: deep-merge allow/deny across scopes so deny from
  // ANY scope (global/project/local) wins, instead of an outer scope's
  // `permissions` object wholesale-replacing an inner one. Fail-safe:
  // non-array / non-object entries collapse to empty arrays, never throw.
  const collectRules = (src: any): { allow: string[]; deny: string[] } => {
    const p = src?.permissions;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { allow: [], deny: [] };
    const allow = Array.isArray(p.allow) ? p.allow.filter((x: unknown) => typeof x === 'string') : [];
    const deny = Array.isArray(p.deny) ? p.deny.filter((x: unknown) => typeof x === 'string') : [];
    return { allow, deny };
  };
  const dedup = (arr: string[]): string[] => Array.from(new Set(arr));
  const g = collectRules(global);
  const l = collectRules(local);
  const lp = collectRules(localPrivate);
  (merged as any).permissions = {
    allow: dedup([...g.allow, ...l.allow, ...lp.allow]),
    deny: dedup([...g.deny, ...l.deny, ...lp.deny]),
  };
}
