import type { AgonConfig } from './agon-config-settings.js';

import { DEFAULT_AGON_CONFIG } from './agon-config-settings.js';

type ConfigScope = 'repo' | 'global';

export interface RepoConfigProjection {
  readonly layer: Partial<AgonConfig>;
  readonly ignored: readonly string[];
}

/**
 * Which keys a cloned repository may set through `.agon.json` and `.agon.local.json`; both files can be committed, so both are untrusted.
 * Mark a key 'repo' only after reading its consumers: its value must be unable to execute, grant, auto-approve, weaken isolation or verification, or redirect anything.
 */
export const REPO_CONFIG_POLICY: Readonly<Record<keyof AgonConfig, ConfigScope>> = Object.freeze({
  commitCoAuthor: 'repo',
  contextFormat: 'repo',
  projectContext: 'repo',

  agentPermissionLevel: 'global',
  agentTimeout: 'global',
  agonPermissionMode: 'global',
  allowedCommands: 'global',
  approvalLevel: 'global',
  autoCredit: 'global',
  autoReviewAfterForge: 'global',
  autoReviewAfterImpl: 'global',
  browserExtensionIds: 'global',
  buddyTimeout: 'global',
  campfireObserverStrategy: 'global',
  cesarActingFallback: 'global',
  cesarAgenticContinuationLimit: 'global',
  cesarApprovalLedger: 'global',
  cesarAutoApproveMaxCostUsd: 'global',
  cesarAutoApproveMode: 'global',
  cesarAutoHarnessProfile: 'global',
  cesarAutoMode: 'global',
  cesarAutoModePrompted: 'global',
  cesarAutoPipeline: 'global',
  cesarBackend: 'global',
  cesarCodeFastPathChars: 'global',
  cesarDangerousTaskPattern: 'global',
  cesarDelegationReflex: 'global',
  cesarDestructiveActionPattern: 'global',
  cesarDirectThreshold: 'global',
  cesarDisagreementSpread: 'global',
  cesarEnabled: 'global',
  cesarEngine: 'global',
  cesarExperience: 'global',
  cesarExperienceMinEpisodes: 'global',
  cesarExperienceMinSimilarity: 'global',
  cesarExperienceTopK: 'global',
  cesarExperienceWindow: 'global',
  cesarGateAutoRun: 'global',
  cesarGateAutoRunLimit: 'global',
  cesarGateOutputTailChars: 'global',
  cesarGateTimeoutSec: 'global',
  cesarImportantTaskPattern: 'global',
  cesarMcpConfigPath: 'global',
  cesarMcpEnabled: 'global',
  cesarMutateReflex: 'global',
  cesarPipelineThreshold: 'global',
  cesarReadRepeatThreshold: 'global',
  cesarReadSpiralThreshold: 'global',
  cesarScoutCount: 'global',
  cesarScoutTimeout: 'global',
  cesarSearchNudgeThreshold: 'global',
  cesarSelfTurnAutoApprove: 'global',
  cesarSelfTurnAutoApproveMaxDiffTokens: 'global',
  cesarSensitivePathPatterns: 'global',
  cesarStreamingXmlTools: 'global',
  cesarToolTimeline: 'global',
  chairExplorationRate: 'global',
  claudeBackend: 'global',
  contextSummary: 'global',
  corpusReplayLimit: 'global',
  daemonFrameMaxBytes: 'global',
  debug: 'global',
  engineActivationMode: 'global',
  engineEfforts: 'global',
  engineIsolation: 'global',
  engineModels: 'global',
  forgeAutoAcceptScore: 'global',
  forgeClearWinnerSpread: 'global',
  forgeDispatchTimeout: 'global',
  forgeEarlyFinalizeEnabled: 'global',
  forgeEarlyFinalizeMinScore: 'global',
  forgeEarlyFinalizePassingCount: 'global',
  forgeEnableSynthesis: 'global',
  forgeEnabledEngines: 'global',
  forgeFitnessTimeout: 'global',
  forgeFixedStarter: 'global',
  forgeHealthCheckApiTimeoutSec: 'global',
  forgeHealthCheckEnabled: 'global',
  forgeHealthCheckTimeoutSec: 'global',
  forgeJudgeEngine: 'global',
  forgeMaxCritiques: 'global',
  forgeMaxParallelApi: 'global',
  forgeRequireBaselineCheck: 'global',
  forgeStarterStrategy: 'global',
  forgeSynthesisTimeout: 'global',
  forgeTimeout: 'global',
  gauntletEnabled: 'global',
  gauntletMaxBreakers: 'global',
  gauntletRepairTimeout: 'global',
  goalReviewEngines: 'global',
  hiddenEngines: 'global',
  hooks: 'global',
  iconTheme: 'global',
  jobCancelGraceMs: 'global',
  jobEventLimit: 'global',
  jobLabelMaxChars: 'global',
  jobMaxConcurrency: 'global',
  jobOutputChunkChars: 'global',
  jobRetentionLimit: 'global',
  jobShutdownTimeoutMs: 'global',
  narrationFold: 'global',
  neroExplorationRate: 'global',
  onboarded: 'global',
  permissionMode: 'global',
  permissions: 'global',
  protectedPushBranches: 'global',
  ratingBallotMaxChars: 'global',
  ratingIdentityConfirmRuns: 'global',
  ratingJudgeTimeoutSec: 'global',
  ratingJudging: 'global',
  ratingMinBallots: 'global',
  ratingStaleHorizonDays: 'global',
  ratingsEnabled: 'global',
  ratingsPurgeKeepEngines: 'global',
  removedEngines: 'global',
  resumePausedPlanOnStartup: 'global',
  reviewContextMaxChars: 'global',
  reviewDefaultEngine: 'global',
  reviewFileContext: 'global',
  reviewMaxDiffChars: 'global',
  reviewMaxTokens: 'global',
  reviewMaxTrees: 'global',
  sessionContinuity: 'global',
  skillSynthesisThreshold: 'global',
  speculativeEloSpreadThreshold: 'global',
  speculativeThresholdUsd: 'global',
  statusLine: 'global',
  terminalMode: 'global',
  timeout: 'global',
  toolPermissions: 'global',
  uiMotion: 'global',
});

const PRINTABLE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const MAX_NAMED_KEYS = 40;
const MAX_WARNED_FILES = 1000;
const warnedFiles = new Set<string>();

function isRepoKey(key: string): key is keyof AgonConfig {
  return Object.hasOwn(REPO_CONFIG_POLICY, key) && REPO_CONFIG_POLICY[key as keyof AgonConfig] === 'repo';
}

function projectPermissions(value: unknown, ignored: string[]): { deny: string[] } | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    ignored.push('permissions');
    return undefined;
  }
  let deny: string[] | undefined;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'deny' && Array.isArray(entry)) deny = entry.filter((rule): rule is string => typeof rule === 'string');
    else ignored.push(`permissions.${key}`);
  }
  return deny && { deny };
}

/**
 * Keep only what a repository may set. `permissions` keeps `deny` alone because the kernel unions it across scopes, so a repository can tighten and never widen or wipe.
 */
export function projectRepoConfigLayer(raw: unknown): RepoConfigProjection {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { layer: {}, ignored: [] };
  const layer: Record<string, unknown> = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'permissions') {
      const permissions = projectPermissions(value, ignored);
      if (permissions) layer.permissions = permissions;
    } else if (isRepoKey(key) && typeof value === typeof DEFAULT_AGON_CONFIG[key]) {
      layer[key] = value;
    } else {
      ignored.push(key);
    }
  }
  return { layer: layer as Partial<AgonConfig>, ignored };
}

/**
 * Key names come from the repository too: anything that could carry terminal escapes is counted, not printed.
 */
export function warnIgnoredRepoConfigKeys(path: string | null | undefined, ignored: readonly string[]): void {
  if (!path || ignored.length === 0 || warnedFiles.has(path)) return;
  if (warnedFiles.size >= MAX_WARNED_FILES) warnedFiles.clear();
  warnedFiles.add(path);
  const named = ignored.filter(key => PRINTABLE_KEY.test(key)).slice(0, MAX_NAMED_KEYS);
  const others = ignored.length - named.length;
  const parts = [...named, ...(others > 0 ? [`${others} other key${others === 1 ? '' : 's'}`] : [])];
  const printablePath = path.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
  console.warn(`[agon] warning: ignoring ${parts.join(', ')} in ${printablePath}: repository config cannot set these. Move them to ~/.agon/config.json.`);
}
