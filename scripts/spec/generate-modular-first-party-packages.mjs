import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
const packageMap = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const ownership = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-ownership.json'), 'utf8'));
const inventory = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-current-inventory.json'), 'utf8'));
const hierarchy = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-ui-hierarchy.json'), 'utf8'));
const physicalContributions = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-physical-contributions.json'), 'utf8')).contributions;

const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];
const surfaceCategories = new Map([
  ['cliCommands', { manifestKind: 'cliCommands', registryKind: 'cli-command' }],
  ['tuiSlashCommands', { manifestKind: 'tuiActions', registryKind: 'tui-action' }],
  ['tuiKeyboardActions', { manifestKind: 'tuiActions', registryKind: 'tui-action' }],
  ['builtinCommandMetadata', { manifestKind: 'tuiActions', registryKind: 'tui-action' }],
  ['intentVariants', { manifestKind: 'tuiActions', registryKind: 'intent' }],
  ['mcpTools', { manifestKind: 'mcpTools', registryKind: 'mcp-tool' }],
  ['cesarTools', { manifestKind: 'cesarTools', registryKind: 'cesar-tool' }],
  ['cesarRoutes', { manifestKind: 'cesarTools', registryKind: 'plan-step' }],
  ['resultAndEnvelopeTypes', { manifestKind: 'resultTypes', registryKind: 'result-type' }],
  ['configKeys', { manifestKind: 'configKeys', registryKind: 'config' }],
  ['generatedDocumentation', { manifestKind: 'generatedDocs', registryKind: 'docs' }],
]);

const compareAscii = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const json = (value) => JSON.stringify(value, null, 2) + '\n';

function ownerId(packageName) {
  if (packageName === '@kernlang/agon-kernel') return 'agon.kernel';
  const short = packageName.replace(/^@kernlang\/agon-(?:mod-|support-)?/, '').replace(/[^a-z0-9]+/g, '-');
  return `agon.${short}`;
}

function shortName(packageName) {
  return packageName.replace('@kernlang/agon-mod-', '');
}

function packageDirectory(packageName) {
  if (packageName === '@kernlang/agon-mod-api') return 'mod-api';
  if (packageName === '@kernlang/agon-kernel') return 'mod-kernel';
  return packageName.replace('@kernlang/agon-', '');
}

function packageVersion(packageName) {
  if (packageName === '@kernlang/agon-mod-api') return '1.0.0';
  if (packageName.includes('/agon-support-')) return '1.0.0';
  if (packageName.includes('/agon-mod-')) return '1.0.0';
  return '>=0.0.0-0';
}

function displayByShort() {
  const result = new Map();
  hierarchy.groups.forEach((group, groupIndex) => {
    if (group.nonToggleable) return;
    group.children.forEach((child, order) => {
      const id = typeof child === 'string' ? child : child.id;
      const parent = typeof child === 'string' ? undefined : child.parent;
      result.set(id, { group: group.label, order: groupIndex * 100 + order, ...(parent ? { parent: `agon.${parent}` } : {}) });
    });
  });
  return result;
}

const displays = displayByShort();
const assignmentKey = (entry) => [entry.category, entry.id, entry.source].join('\0');
const assignmentByOccurrence = new Map(ownership.assignments.map((entry) => [assignmentKey(entry), entry]));
const legacySettings = new Map();

function contributionsFor(packageName) {
  const result = [];
  for (const [category, projection] of surfaceCategories) {
    for (const [index, occurrence] of (inventory.categories[category] ?? []).entries()) {
      const assignment = assignmentByOccurrence.get(assignmentKey({ category, id: occurrence.id, source: occurrence.source }));
      if (assignment?.package !== packageName) continue;
      result.push({
        id: `${category}:${String(index).padStart(4, '0')}`,
        publicId: occurrence.id,
        category,
        source: occurrence.source,
        ...projection,
      });
    }
  }
  for (const contribution of physicalContributions) {
    if (contribution.package !== packageName) continue;
    result.push({
      id: contribution.registryId,
      publicId: contribution.publicId,
      category: contribution.category,
      source: contribution.source,
      manifestKind: contribution.manifestKind,
      registryKind: contribution.kind,
    });
  }
  return result.sort((left, right) => compareAscii(left.registryKind, right.registryKind) || compareAscii(left.id, right.id));
}

function expectedFiles(packageRecord) {
  const packageName = packageRecord.id;
  const short = shortName(packageName);
  const directory = resolve(root, 'packages', `mod-${short}`);
  const packageAssignments = ownership.assignments
    .filter((entry) => entry.package === packageName)
    .sort((left, right) => compareAscii(left.category, right.category) || compareAscii(left.id, right.id) || compareAscii(left.source, right.source));
  const ownershipText = json({ schemaVersion: 1, package: packageName, assignments: packageAssignments });
  // The owner authors this schema. Generated compatibility data cannot own it.
  const configSchema = readFileSync(resolve(directory, 'schemas/config.schema.json'), 'utf8');
  const configDefinition = JSON.parse(configSchema);
  for (const assignment of packageAssignments.filter(entry => entry.category === 'configKeys')) {
    if (!Object.hasOwn(configDefinition.properties ?? {}, assignment.id)) continue;
    const property = configDefinition.properties?.[assignment.id];
    if (!property || typeof property !== 'object' || Array.isArray(property)) throw new Error(`legacy setting requires a schema object: ${assignment.id}`);
    if (legacySettings.has(assignment.id)) throw new Error(`duplicate settings owner: ${assignment.id}`);
    const type = ['boolean', 'number', 'string'].includes(property.type) ? property.type
      : property.type === 'array' && property.items?.type === 'string' ? 'string[]' : undefined;
    if (!type || !Object.hasOwn(property, 'default')) throw new Error(`legacy setting requires an explicit type and default: ${assignment.id}`);
    const validDefault = type === 'string[]' ? Array.isArray(property.default) && property.default.every(value => typeof value === 'string')
      : typeof property.default === type && (type !== 'number' || Number.isFinite(property.default));
    if (!validDefault) throw new Error(`legacy setting default has the wrong type: ${assignment.id}`);
    legacySettings.set(assignment.id, { type, value: property.default });
  }
  const contributions = contributionsFor(packageName);
  const byManifestKind = Object.fromEntries([
    'cliCommands', 'tuiActions', 'mcpTools', 'cesarTools', 'lifecycleHooks',
    'resultTypes', 'configKeys', 'generatedDocs',
  ].map((kind) => [kind, contributions.filter((entry) => entry.manifestKind === kind).map(({ id }) => ({ id, aliases: [] }))]));
  const display = displays.get(short);
  if (!display) throw new Error(`missing UI hierarchy placement for ${packageName}`);
  const dependencies = packageRecord.dependencies.map((dependency) => ({ id: ownerId(dependency), range: '>=0.0.0-0' }));
  const implementationPath = resolve(directory, 'src/implementation.ts');
  const isPhysical = existsSync(implementationPath);
  const implementationSource = isPhysical ? readFileSync(implementationPath, 'utf8') : '';
  const inferredPermissions = new Set(
    [...implementationSource.matchAll(/permissions\.check\(['"]([^'"]+)['"]/g)].map((match) => match[1]),
  );
  if (/services\.engines\.dispatch\b/.test(implementationSource)) inferredPermissions.add('engine.dispatch');
  if (/services\.state\.read\b/.test(implementationSource)) inferredPermissions.add('state.read');
  if (/services\.state\.write\b/.test(implementationSource)) inferredPermissions.add('state.write');
  // Composite workflows invoke child mods with the caller's service boundary,
  // so their transitive effects must remain visible in the parent manifest.
  if (['conquer', 'goal', 'pipeline-delivery', 'pipeline-orchestration'].includes(short)) inferredPermissions.add('engine.dispatch');
  // Brainstorm seats dispatch through host-supplied services, so the source
  // pattern above cannot see an effect the mod still performs.
  if (short === 'brainstorm') inferredPermissions.add('engine.dispatch');
  // Jobs persists scheduler observations through its separate storage adapter.
  if (short === 'jobs') inferredPermissions.add('state.write');
  const physicalPackFiles = isPhysical ? ['dist/implementation.d.ts', ...(short === 'rag' ? ['dist/store.d.ts', 'dist/types.d.ts', 'dist/grounding.d.ts']
    : short === 'think' ? ['dist/thinking.d.ts']
    : short === 'forge' ? ['dist/apply.d.ts']
    : short === 'plan' ? ['dist/agent-review-step-execution.d.ts', 'dist/forge-step-execution.d.ts', 'dist/pipeline-step-execution.d.ts', 'dist/self-step-execution.d.ts', 'dist/approval-policy.d.ts', 'dist/cost-estimator.d.ts', 'dist/execution-callbacks.d.ts', 'dist/execution-coordinator.d.ts', 'dist/execution-model.d.ts', 'dist/execution-state.d.ts', 'dist/execution-store.d.ts', 'dist/executor.d.ts', 'dist/formatter.d.ts', 'dist/panel-step-execution.d.ts', 'dist/proposal-workflow.d.ts', 'dist/resume-policy.d.ts', 'dist/resume-workflow.d.ts', 'dist/runtime.d.ts', 'dist/session-scope.d.ts', 'dist/session-selection.d.ts', 'dist/session-workflow.d.ts', 'dist/session.d.ts', 'dist/step-validation.d.ts']
    : short === 'brainstorm' ? ['dist/collector.d.ts', 'dist/host.d.ts', 'dist/policy.d.ts', 'dist/presentation.d.ts', 'dist/result.d.ts', 'dist/runtime.d.ts', 'dist/scout.d.ts', 'dist/session-record.d.ts', 'dist/session-workflow.d.ts', 'dist/workflow.d.ts']
    : short === 'jobs' ? ['dist/daemon-controller.d.ts', 'dist/cli-projection.d.ts', 'dist/cli-invocation.d.ts', 'dist/cli-client.d.ts', 'dist/cli-contract.d.ts', 'dist/daemon-contract.d.ts', 'dist/daemon-job-router.d.ts', 'dist/daemon-workflow.d.ts', 'dist/job-service.d.ts', 'dist/mcp-contract.d.ts', 'dist/persisted-job-service.d.ts', 'dist/session-jobs.d.ts', 'dist/workflow-process.d.ts']
    : short === 'ratings' ? ['dist/maintenance.d.ts', 'dist/glicko.d.ts', 'dist/types.d.ts', 'dist/storage.d.ts']
    : short === 'routing-docs' ? ['dist/guide-content.d.ts']
    : short === 'worktrees' ? ['dist/runtime.d.ts', 'dist/workspaces.d.ts']
    : short === 'rooms' ? ['dist/paths.d.ts', 'dist/runtime/index.d.ts', 'dist/runtime/store.d.ts', 'dist/runtime/presence.d.ts', 'dist/runtime/unread.d.ts', 'dist/runtime/locks.d.ts', 'dist/runtime/leases.d.ts', 'dist/runtime/auto-policy.d.ts', 'dist/runtime/tail.d.ts', 'dist/runtime/tasks.d.ts', 'dist/runtime/types.d.ts']
    : [])] : [];
  const manifest = {
    schemaVersion: 2,
    id: ownerId(packageName),
    name: short.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '),
    version: '1.0.0',
    apiRange: '>=1.0.0 <2',
    execution: 'executable',
    compatibility: { kernelRange: '>=0.0.0-0 <2', nodeRange: '>=22' },
    packageClass: 'user-toggleable-mod-package',
    entrypoints: { runtime: 'dist/index.js', types: 'dist/index.d.ts' },
    display,
    dependencies: { required: dependencies, optional: [], conflicts: [] },
    permissions: [...inferredPermissions].sort(compareAscii).map((capability) => ({
      capability,
      resources: [],
      required: !(short === 'worktrees' && capability === 'network'),
    })),
    platforms,
    assets: [
      { path: 'ownership.json', kind: 'documentation', mediaType: 'application/json', contentHash: sha256(ownershipText), bytes: Buffer.byteLength(ownershipText), executable: false, platforms },
      { path: 'schemas/config.schema.json', kind: 'schema', mediaType: 'application/schema+json', contentHash: sha256(configSchema), bytes: Buffer.byteLength(configSchema), executable: false, platforms },
    ],
    contributes: byManifestKind,
    pack: { include: ['LICENSE', 'agon.mod.json', 'dist/index.js', 'dist/index.d.ts', ...physicalPackFiles, 'ownership.json', 'schemas/config.schema.json'], executable: [] },
  };

  const dependencyVersions = Object.fromEntries(packageRecord.dependencies.map((dependency) => [dependency, packageVersion(dependency)]));
  if (short === 'research') dependencyVersions.undici = '^6.28.0';
  const packageJson = {
    name: packageName,
    version: '1.0.0',
    private: false,
    license: 'MIT',
    type: 'module',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './manifest': './agon.mod.json', './ownership': './ownership.json' },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    files: short === 'plan'
      ? ['dist/index.js', 'dist/index.d.ts', ...physicalPackFiles, 'schemas', 'agon.mod.json', 'ownership.json', 'LICENSE']
      : ['dist', 'schemas', 'agon.mod.json', 'ownership.json', 'LICENSE'],
    sideEffects: false,
    scripts: { build: 'tsup && tsc -b tsconfig.json --force', typecheck: 'tsc --noEmit' },
    peerDependencies: { '@kernlang/agon-kernel': '>=0.0.0-0 <2' },
    dependencies: dependencyVersions,
  };
  const paths = Object.fromEntries(packageRecord.dependencies.map((dependency) => [dependency, [`../${packageDirectory(dependency)}/src/index.ts`]]));
  const references = packageRecord.dependencies.map((dependency) => ({ path: `../${packageDirectory(dependency)}` }));
  const tsconfig = {
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      composite: true,
      outDir: 'dist',
      rootDir: 'src',
      baseUrl: '.',
      paths,
      sourceMap: false,
      declarationMap: false,
      emitDeclarationOnly: true,
    },
    references,
    include: ['src'],
    exclude: ['src/**/*.test.ts'],
  };
  const runtimeRecords = contributions.map(({ id, publicId, registryKind, category, source }) => ({ id, publicId, registryKind, category, source }));
  const physicalExports = short === 'browser' ? `export { driveBrowser, runServe, browserHost } from './implementation.js';
` : short === 'worktrees' ? `export { runWorktree, runWorkspace } from './implementation.js';
export * from './workspaces.js';
` : short === 'skill-authoring' ? `export { createSkill } from './implementation.js';
` : short === 'routing-docs' ? `export { runGuide } from './implementation.js';
export { agentGuideMarkdown, modeDocsMarkdown, renderModeDocsProjection, agonShim, codexSkillMarkdown, codexSkillOpenAiYaml } from './guide-content.js';
` : short === 'rooms' ? `export { roomAction } from './implementation.js';
export * from './runtime/index.js';
` : short === 'flow' ? `export { runFlow } from './implementation.js';
` : short === 'memory' ? `export { saveMemory } from './implementation.js';
` : short === 'ratings' ? `export { runRatings, loadRatings } from './implementation.js';
export * as glicko from './glicko.js';
export type { GlickoRating, EngineMeta, RatingRecord } from './types.js';
export { computeUnknownEngineIds, computeRunManifestPurge, purgeRatingsStore } from './maintenance.js';
export type { PurgeReport, RatingsMaintenanceStore } from './maintenance.js';
` : short === 'provenance' ? `export { runProvenance, buildProvenance, renderMarkdown } from './implementation.js';
` : short === 'rag' ? `export * from './store.js';
export * from './grounding.js';
export type * from './types.js';
export { runRag, buildRagIndex, queryRag, collectCorpusFiles, chunkMarkdown } from './implementation.js';
` : short === 'history' ? `export { runHistory } from './implementation.js';
` : short === 'research' ? `export { runResearch, classifyQuery, validateUrl, formatResearchResult } from './implementation.js';
` : short === 'mutate' ? `export { runMutate, generateMutants } from './implementation.js';
` : short === 'naturalize' ? `export { runNaturalize } from './implementation.js';
` : short === 'sanitize' ? `export { runSanitize, scanText, cleanText } from './implementation.js';
` : short === 'goal' ? `export { runGoal } from './implementation.js';
` : short === 'plan' ? `export { createPersistenceEnvelope, unwrapPersistenceEnvelope } from './implementation.js';
export { PlanCostEstimator } from './cost-estimator.js';
export { createPlanRuntime } from './runtime.js';
export { planSessionHost, withPlanSession } from './session-scope.js';
export { selectPendingPlan, selectResumablePlan, shouldApprovePendingCesarPlanInput, isCesarPlanApprovalInput, isStrongCesarPlanApprovalInput, isCesarPlanResumeInput, isCesarPlanStatusInput, formatCesarPlanRuntimeStatus } from './session-selection.js';
export type { PlanSessionSnapshot } from './session-selection.js';
export { startPlanTaskSession, resumePlanSession, exitPlanSession } from './session-workflow.js';
export type { PlanTaskSessionEffects, PlanResumeSessionEffects, PlanExitSessionEffects } from './session-workflow.js';
export { publishPlanProposal, activatePlanProposal, rejectPlanProposal } from './proposal-workflow.js';
export type { PlanProposalPublicationEffects, PlanProposalEffects, PlanRejectionEffects } from './proposal-workflow.js';
export { evaluatePlanAutoApproval, evaluateAgenticPlanAutoApproval, MUTATING_STEP_TYPES } from './approval-policy.js';
export type { PlanApprovalConfig, PlanApprovalEffects, PlanActionEvaluator, AutoApproveDecision } from './approval-policy.js';
export type { CostEstimate, PlanCostPricing } from './cost-estimator.js';
export { createPlanStepSanitizer, VALID_STEP_TYPES } from './step-validation.js';
export type { PlanStepEstimator } from './step-validation.js';
export { formatCesarPlanMarkdown, formatStepType } from './formatter.js';
export { createPanelStepExecutors, buildPlanStepContext, resolvePlanStepEngines } from './panel-step-execution.js';
export { createSelfStepExecutor } from './self-step-execution.js';
export { createAgentReviewStepExecutors } from './agent-review-step-execution.js';
export type { PlanAgentReviewHost, PlanAgentReviewStepType, PlanAgentStepOutcome } from './agent-review-step-execution.js';
export { createForgeStepExecutors } from './forge-step-execution.js';
export type { PlanForgeHost, PlanForgeEvent, PlanForgeManifest, PlanForgeUiEvent } from './forge-step-execution.js';
export { createPipelineStepExecutor } from './pipeline-step-execution.js';
export type { PlanPipelineHost, PlanPipelineRun, PlanPipelineIssue, PlanPipelineUiEvent } from './pipeline-step-execution.js';
export type { PlanSelfStepHost, PlanSelfEvent, PlanSelfNotice } from './self-step-execution.js';
export type { PlanPanelStepHost, PlanPanelStepType } from './panel-step-execution.js';
export { createPlanExecutor, getReadySteps } from './executor.js';
export type { PlanExecutionServices, PlanExecutorCallbacks, StepExecutor } from './executor.js';
export type { CesarPlan, CesarPlanStep, CesarPlanState, CesarStepState, CesarStepType, CesarStepResult } from './execution-model.js';
export { CESAR_STEP_TYPES, CESAR_STEP_TYPE_TABLE } from './execution-model.js';
export { createCesarPlan, createPlanProposal, approveCesarPlan, advanceCesarStep, cancelCesarPlan, exitCesarPlan } from './execution-state.js';
export { buildResumePromptContext, skipCompletedSteps, prepareCesarPlanResume } from './resume-policy.js';
export type { ResumePromptContext } from './resume-policy.js';
export { runPlanResumeApproval } from './resume-workflow.js';
export type { PlanResumeApprovalEffects } from './resume-workflow.js';
export { createPlanCallbacks } from './execution-callbacks.js';
export type { PlanCallbackEvent, PlanCallbackHost, PlanCallbacks } from './execution-callbacks.js';
export { createPlanCoordinator, failedPlanStepIsFallbackRetryable, preparePlanFallbackRetry } from './execution-coordinator.js';
export type { PlanCoordinatorHost } from './execution-coordinator.js';
export { getCesarPlansDir, cesarPlanJsonPath, cesarPlanMarkdownPath, saveCesarPlan, loadCesarPlan, listCesarPlans } from './execution-store.js';
` : short === 'jobs' ? `export { ModularJobService } from './implementation.js';
export { JOB_TOOLS, isJobTool, requiredString, optionalInteger, buildMcpJobCommand } from './mcp-contract.js';
export { JobService } from './job-service.js';
export { emitChunks, runWorkflowCommand } from './workflow-process.js';
export { runSessionJobAction, runSessionJobContribution } from './session-jobs.js';
export { positiveJobCliInteger, nonNegativeInteger, parsePayload, buildSubmitPayload, jobsCapability, jobOutcomeExitCode, jobSnapshotExitCode, timingFromArgs } from './cli-contract.js';
export type { JobClientTiming, JobClientConnection } from './cli-contract.js';
export { createJobCliClient } from './cli-client.js';
export { createDaemonController, HEARTBEAT_MS, HEARTBEAT_STALE_MS, PING_TIMEOUT_MS } from './daemon-controller.js';
export type { DaemonControllerHost, DaemonPidInfo, DaemonLiveness } from './daemon-controller.js';
export { daemonCliCommand, jobCliCommands, jobCliProjection, connectionArgs, waitArgs } from './cli-projection.js';
export type { JobCliAction, JobCliArgument } from './cli-projection.js';
export { runJobCliContribution } from './cli-invocation.js';
export type { JobCliInvocationContext } from './cli-invocation.js';
export type { JobCliHost, JobCliRequest, JobCliResponse } from './cli-client.js';
export type { SessionJob, SessionJobEvent, SessionJobsHost, SessionJobsInvocationContext } from './session-jobs.js';
export { createDaemonWorkflowRuntime, daemonWorkflowKinds, positiveRuntimeInteger, assertWorkingDirectory, SAFE_WORKFLOW_KINDS, PAYLOAD_FIELDS, STRING_PAYLOAD_FIELDS } from './daemon-workflow.js';
export type { DaemonWorkflowHost, DaemonWorkflowKind, DaemonWorkflowPlan, DaemonWorkflowRuntimeOptions } from './daemon-workflow.js';
export { handleDaemonJobRequest, isDaemonJobRequest } from './daemon-job-router.js';
export type { DaemonJobResolver, ResolvedJob } from './daemon-job-router.js';
export type { DaemonJobRequest, DaemonJobResponse } from './daemon-contract.js';
export type { JobState, TerminalJobState, JobSnapshot, JobEvent, JobEventPage, JobOutcome, JobObservation, JobTaskContext, JobExecutor, JobServiceOptions } from './job-service.js';
` : short === 'git-actions' ? `export { runGitAction } from './implementation.js';
` : short === 'forge' ? `export { runForgeCompetition } from './implementation.js';
` : short === 'brainstorm' ? `export { runBrainstorm } from './implementation.js';
export { createBrainstormWorkflow } from './workflow.js';
export { createBrainstormRuntime } from './runtime.js';
export type { BrainstormRuntimeServices } from './runtime.js';
export type { BrainstormHostServices, BrainstormModServices } from './host.js';
export { createBrainstormHostServices } from './host.js';
export { createBrainstormEngineServices } from './host.js';
export type { BrainstormEngineOptions, BrainstormEngineEffects } from './host.js';
export type { BrainstormHostEffects } from './host.js';
export type { BrainstormInvocationContext, BrainstormWorkflowEvent } from './host.js';
export { createBrainstormCollector } from './collector.js';
export type { BrainstormCollection, RankedBrainstormDraft, BrainstormCollectorServices } from './collector.js';
export { createBrainstormScout } from './scout.js';
export type { BrainstormScoutOptions, BrainstormScoutBid, BrainstormScoutServices } from './scout.js';
export { createBrainstormScoring, structuralScore, scoutScore, assignStances, fallbackParse } from './policy.js';
export type { BrainstormRatingHistory, ScoutScoreInput } from './policy.js';
export type { BrainstormWorkflowOptions, BrainstormWorkflowServices, BrainstormDraft, BrainstormBid } from './workflow.js';
export { createBrainstormSessionRecord } from './session-record.js';
export { createBrainstormPresentation } from './presentation.js';
export type { BrainstormPresentationHost, BrainstormPresentationEvent, BrainstormProgress } from './presentation.js';
export type { BrainstormSessionEffects, BrainstormSessionResult } from './session-record.js';
export { runBrainstormSession } from './session-workflow.js';
export { parseBrainstormResult } from './result.js';
export type { BrainstormResult } from './result.js';
export type { BrainstormSessionHost, BrainstormSessionCommandResult, BrainstormSessionExecutionContext } from './session-workflow.js';
` : short === 'tribunal' ? `export { runTribunal } from './implementation.js';
` : short === 'review' ? `export { runReview } from './implementation.js';
` : short === 'agent' ? `export { runAgentTask } from './implementation.js';
` : short === 'nero' ? `export { runNero } from './implementation.js';
` : short === 'council' ? `export { runCouncil } from './implementation.js';
` : '';
  const resultSchemaName = contributions.some(({ registryKind }) => registryKind === 'result-type') ? 'resultSchema' : '_resultSchema';
  const indexSource = existsSync(implementationPath) ? `import { validateManifest } from '@kernlang/agon-mod-api';\nimport manifest from '../agon.mod.json' with { type: 'json' };\nimport ownership from '../ownership.json' with { type: 'json' };\n\nexport const MANIFEST = validateManifest(manifest);\nexport const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);\n\nexport const IMPLEMENTATION_KIND = 'physical' as const;\nexport { createMod } from './implementation.js';\nexport { createMod as default } from './implementation.js';\n${physicalExports}` : `import { validateManifest } from '@kernlang/agon-mod-api';\nimport type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';\n\nexport const MANIFEST = validateManifest(${JSON.stringify(manifest, null, 2)});\nexport const SOURCE_OCCURRENCES = Object.freeze(${JSON.stringify(packageAssignments, null, 2)});\nexport const COMPATIBILITY_CONTRIBUTIONS = Object.freeze(${JSON.stringify(runtimeRecords, null, 2)});\n\nexport interface FirstPartyCompatibilityRuntime {\n  command(kind: string, id: string, input: Json, context: InvocationContext): InvocationOutput;\n  tool(kind: string, id: string, input: Json, context: InvocationContext): Awaitable<Json>;\n  parseIntent(id: string, input: string): Awaitable<Json | undefined>;\n  lifecycle(id: string, payload: Json, context: InvocationContext): Awaitable<void>;\n  render(id: string, payload: Json): Awaitable<{ readonly text: string; readonly markdown?: string }>;\n}\n\ntype FirstPartyServices = ModServices & { readonly firstPartyCompatibility?: FirstPartyCompatibilityRuntime };\nconst inputSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;\nconst ${resultSchemaName} = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;\n\nexport function createFirstPartyCompatibilityMod(runtime: FirstPartyCompatibilityRuntime): AgonModV1 {\n  return Object.freeze({\n    apiVersion: '1' as const,\n    async activate(registrar: Registrar): Promise<Dispose> {\n      const disposers: Dispose[] = [];\n${contributions.map((entry) => {
  const label = JSON.stringify(`${entry.publicId} compatibility contribution`);
  const id = JSON.stringify(entry.id);
  const publicId = JSON.stringify(entry.publicId);
  if (entry.registryKind === 'cli-command') return `      disposers.push(registrar.command('cli', { id: ${id}, description: ${label}, inputSchema, run: (input, context) => runtime.command('cli-command', ${publicId}, input, context) }));`;
  if (entry.registryKind === 'tui-action') return `      disposers.push(registrar.command('tui', { id: ${id}, description: ${label}, inputSchema, run: (input, context) => runtime.command('tui-action', ${publicId}, input, context) }));`;
  if (entry.registryKind === 'intent') return `      disposers.push(registrar.intent({ id: ${id}, description: ${label}, inputSchema, parse: (input) => runtime.parseIntent(${publicId}, input), run: (input, context) => runtime.command('intent', ${publicId}, input, context) }));`;
  if (entry.registryKind === 'mcp-tool') return `      disposers.push(registrar.tool('mcp', { id: ${id}, description: ${label}, inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', ${publicId}, input, context) }));`;
  if (entry.registryKind === 'cesar-tool') return `      disposers.push(registrar.tool('cesar', { id: ${id}, description: ${label}, inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', ${publicId}, input, context) }));`;
  if (entry.registryKind === 'result-type') return `      disposers.push(registrar.resultType({ id: ${id}, schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render(${publicId}, payload) }));`;
  if (entry.registryKind === 'config') return `      disposers.push(registrar.config(${id}, inputSchema));`;
  if (entry.registryKind === 'docs') return `      disposers.push(registrar.docs({ id: ${id}, title: ${label}, markdown: ${JSON.stringify(`Compatibility documentation owned by ${packageName}.`)} }));`;
  throw new Error(`unsupported registry kind: ${entry.registryKind}`);
}).join('\n')}\n      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };\n    },\n  });\n}\n\nexport const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {\n  const runtime = (services as FirstPartyServices).firstPartyCompatibility;\n  if (!runtime) {\n    throw Object.assign(new Error('${packageName} requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });\n  }\n  return createFirstPartyCompatibilityMod(runtime);\n};\n\nexport default createMod;\n${physicalExports}`;
  return new Map([
    [resolve(directory, 'package.json'), json(packageJson)],
    [resolve(directory, 'agon.mod.json'), json(manifest)],
    [resolve(directory, 'ownership.json'), ownershipText],
    [resolve(directory, 'src/index.ts'), indexSource],
    [resolve(directory, 'LICENSE'), readFileSync(resolve(root, 'LICENSE'), 'utf8')],
    [resolve(directory, 'tsconfig.json'), json(tsconfig)],
    [resolve(directory, 'tsup.config.ts'), "import { defineConfig } from 'tsup';\n\nexport default defineConfig({ entry: ['src/index.ts'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });\n"],
  ]);
}

const mods = packageMap.packages.filter((entry) => entry.class === 'user-toggleable-mod-package');
if (mods.length !== 36) throw new Error(`expected 36 first-party mods, got ${mods.length}`);
const generated = new Map();
for (const mod of mods) for (const [path, source] of expectedFiles(mod)) generated.set(path, source);
const settings = [...legacySettings].sort(([left], [right]) => compareAscii(left, right));
generated.set(resolve(root, 'packages/core/src/models/first-party-settings.generated.ts'),
  '// Generated from owner configuration schemas. Run generate-modular-first-party-packages.mjs.\n'
  + 'export interface FirstPartyLegacySettings {\n'
  + settings.map(([key, value]) => `  ${key}?: ${value.type};`).join('\n')
  + '\n}\n\nexport const DEFAULT_FIRST_PARTY_SETTINGS: Required<FirstPartyLegacySettings> = '
  + JSON.stringify(Object.fromEntries(settings.map(([key, value]) => [key, value.value])), null, 2) + ';\n');

const rootPackagePath = resolve(root, 'package.json');
const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
const modWorkspaces = mods.map((entry) => `packages/mod-${shortName(entry.id)}`);
rootPackage.workspaces = [...rootPackage.workspaces.filter((entry) => !entry.startsWith('packages/mod-') || ['packages/mod-api', 'packages/mod-kernel'].includes(entry)), ...modWorkspaces];
generated.set(rootPackagePath, json(rootPackage));

const rootTsconfigPath = resolve(root, 'tsconfig.json');
const rootTsconfig = JSON.parse(readFileSync(rootTsconfigPath, 'utf8'));
const retainedReferences = rootTsconfig.references.filter(({ path }) => !path.startsWith('packages/mod-') || ['packages/mod-api', 'packages/mod-kernel'].includes(path));
rootTsconfig.references = [...retainedReferences, ...mods.map((entry) => ({ path: `packages/mod-${shortName(entry.id)}` }))];
generated.set(rootTsconfigPath, json(rootTsconfig));

const stale = [];
for (const [path, source] of generated) {
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== source) stale.push(path.replace(root + '/', ''));
    continue;
  }
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, source);
}
if (stale.length) {
  console.error(`first-party package generation drift:\n${stale.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`${check ? 'verified' : 'generated'} ${mods.length} first-party packages and ${generated.size} files`);
}
