import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const baselineEvidenceDir = join(root, 'docs/specs/evidence');
const evidenceDir = resolve(process.env.AGON_SPEC_EVIDENCE_DIR || baselineEvidenceDir);
mkdirSync(evidenceDir, { recursive: true });
const inventory = JSON.parse(readFileSync(join(evidenceDir, 'modular-agon-current-inventory.json'), 'utf8'));
const frozenOwnership = JSON.parse(readFileSync(join(baselineEvidenceDir, 'modular-agon-ownership.json'), 'utf8'));
const occurrenceKey = (category, item) => [category, item.id, item.source].join('\0');
const semanticKey = (category, item) => [category, item.id].join('\0');
const frozenKernelDefaults = new Set(frozenOwnership.assignments
  .filter(({ rule }) => rule === 'kernel-contract-default')
  .map((assignment) => semanticKey(assignment.category, assignment)));

const KERNEL = 'minimal-kernel-machinery';
const SUPPORT = 'hidden-shared-support-package';
const MOD = 'user-toggleable-mod-package';

const packages = [
  { id: '@kernlang/agon-kernel', class: KERNEL, defaultEnabled: true, dependencies: ['@kernlang/agon-mod-api'] },
  { id: '@kernlang/agon-mod-api', class: KERNEL, defaultEnabled: true, dependencies: [] },
  { id: '@kernlang/agon-support-engine-runtime', class: SUPPORT, defaultEnabled: true, dependencies: ['@kernlang/agon-kernel'] },
  { id: '@kernlang/agon-support-engine-catalog', class: SUPPORT, defaultEnabled: true, dependencies: ['@kernlang/agon-support-engine-runtime'] },
  { id: '@kernlang/agon-support-persistence', class: SUPPORT, defaultEnabled: true, dependencies: ['@kernlang/agon-kernel'] },
  { id: '@kernlang/agon-support-verification', class: SUPPORT, defaultEnabled: true, dependencies: ['@kernlang/agon-kernel', '@kernlang/agon-support-persistence'] },
  { id: '@kernlang/agon-support-worktree', class: SUPPORT, defaultEnabled: true, dependencies: ['@kernlang/agon-kernel', '@kernlang/agon-support-verification'] },
  { id: '@kernlang/agon-support-panel', class: SUPPORT, defaultEnabled: true, dependencies: ['@kernlang/agon-support-engine-runtime'] },
  { id: '@kernlang/agon-support-judge', class: SUPPORT, defaultEnabled: true, dependencies: ['@kernlang/agon-support-panel', '@kernlang/agon-support-verification'] },
  { id: '@kernlang/agon-support-agent-runtime', class: SUPPORT, defaultEnabled: true, dependencies: ['@kernlang/agon-support-engine-runtime', '@kernlang/agon-support-persistence', '@kernlang/agon-support-verification'] },
  { id: '@kernlang/agon-support-dedup', class: SUPPORT, defaultEnabled: true, dependencies: ['@kernlang/agon-kernel'] },
  { id: '@kernlang/agon-support-browser-bridge', class: SUPPORT, defaultEnabled: true, dependencies: ['@kernlang/agon-kernel'] },
  { id: '@kernlang/agon-support-saas-api', class: SUPPORT, defaultEnabled: false, dependencies: ['@kernlang/agon-kernel'] },
];

const mods = {
  ask: [],
  plan: ['@kernlang/agon-support-persistence', '@kernlang/agon-support-verification'],
  think: ['@kernlang/agon-support-engine-runtime'],
  brainstorm: ['@kernlang/agon-support-panel', '@kernlang/agon-support-dedup'],
  'team-brainstorm': ['@kernlang/agon-mod-brainstorm', '@kernlang/agon-support-panel'],
  tribunal: ['@kernlang/agon-support-panel', '@kernlang/agon-support-judge'],
  'team-tribunal': ['@kernlang/agon-mod-tribunal', '@kernlang/agon-support-panel'],
  campfire: ['@kernlang/agon-support-panel'],
  forge: ['@kernlang/agon-support-panel', '@kernlang/agon-support-judge', '@kernlang/agon-support-worktree', '@kernlang/agon-support-verification'],
  'team-forge': ['@kernlang/agon-mod-forge', '@kernlang/agon-support-panel'],
  synthesis: ['@kernlang/agon-support-panel', '@kernlang/agon-support-judge'],
  review: ['@kernlang/agon-support-panel', '@kernlang/agon-support-verification'],
  'pipeline-orchestration': ['@kernlang/agon-mod-brainstorm', '@kernlang/agon-mod-forge', '@kernlang/agon-mod-tribunal'],
  'pipeline-delivery': ['@kernlang/agon-mod-agent', '@kernlang/agon-mod-review'],
  agent: ['@kernlang/agon-support-agent-runtime'],
  goal: ['@kernlang/agon-mod-plan', '@kernlang/agon-mod-agent', '@kernlang/agon-mod-review', '@kernlang/agon-mod-jobs', '@kernlang/agon-mod-git-actions'],
  conquer: ['@kernlang/agon-mod-agent', '@kernlang/agon-mod-nero', '@kernlang/agon-mod-tribunal', '@kernlang/agon-mod-council'],
  nero: ['@kernlang/agon-support-judge'],
  council: ['@kernlang/agon-support-panel', '@kernlang/agon-support-judge'],
  research: ['@kernlang/agon-support-engine-runtime'],
  rag: ['@kernlang/agon-support-persistence', '@kernlang/agon-support-dedup'],
  mutate: ['@kernlang/agon-support-verification'],
  naturalize: ['@kernlang/agon-support-engine-runtime'],
  sanitize: ['@kernlang/agon-support-engine-runtime'],
  rooms: ['@kernlang/agon-support-persistence'],
  jobs: ['@kernlang/agon-support-persistence'],
  browser: ['@kernlang/agon-support-browser-bridge', '@kernlang/agon-support-agent-runtime'],
  ratings: ['@kernlang/agon-support-persistence'],
  history: ['@kernlang/agon-support-persistence'],
  provenance: ['@kernlang/agon-support-persistence'],
  flow: ['@kernlang/agon-support-persistence'],
  memory: ['@kernlang/agon-support-persistence'],
  worktrees: ['@kernlang/agon-support-worktree'],
  'skill-authoring': ['@kernlang/agon-support-persistence'],
  'git-actions': ['@kernlang/agon-support-verification'],
  'routing-docs': ['@kernlang/agon-support-persistence'],
};
for (const [name, dependencies] of Object.entries(mods)) {
  packages.push({ id: '@kernlang/agon-mod-' + name, class: MOD, defaultEnabled: true, dependencies: [...new Set(['@kernlang/agon-mod-api', '@kernlang/agon-support-engine-runtime', ...dependencies])] });
}

const kernelSurface = new Set([
  'call', 'config', 'doctor', 'engine', 'login', 'models', 'provider', 'update', 'upgrade',
  '/btw', '/cesar', '/cesar-hints', '/cesar-report', '/chats', '/checkpoints', '/clean', '/clear', '/compact', '/config', '/cp', '/doctor', '/engines', '/exit', '/help', '/harness-replay', '/img', '/init', '/mcp', '/mode', '/models', '/nogate', '/permissions', '/provider', '/raw', '/run', '/status', '/tokens',
  'btw', 'cesar', 'cesar-hints', 'cesar-report', 'chat', 'chats', 'chats-resume', 'checkpoints', 'clear', 'compact', 'config', 'cp', 'discover', 'doctor', 'engines', 'exit', 'harness-replay', 'help', 'img', 'init', 'mcp', 'models', 'nogate', 'permissions', 'provider', 'raw', 'run', 'slash-list', 'status', 'tokens', 'unknown', 'use',
  'AgonBash', 'AgonEdit', 'AgonWrite', 'DeliverAnswer', 'ReportConfidence',
  'Bash', 'Edit', 'Glob', 'Grep', 'MultiEdit', 'Read', 'ReportConfidence', 'RetrieveResult', 'TodoWrite', 'Write',
]);

const directMod = new Map([
  ['ask', 'ask'], ['think', 'think'], ['brainstorm', 'brainstorm'], ['team-brainstorm', 'team-brainstorm'],
  ['plan', 'plan'], ['plans', 'plan'], ['approve', 'plan'], ['retry', 'plan'], ['cancel', 'plan'], ['auto', 'plan'], ['ProposePlan', 'plan'], ['ExitPlanMode', 'plan'], ['ListPlans', 'plan'],
  ['tribunal', 'tribunal'], ['team-tribunal', 'team-tribunal'], ['campfire', 'campfire'], ['forge', 'forge'], ['team-forge', 'team-forge'],
  ['synthesis', 'synthesis'], ['review', 'review'], ['review role', 'review'], ['agent', 'agent'], ['agent-solo', 'agent'], ['team-agent', 'agent'], ['build', 'agent'],
  ['goal', 'goal'], ['conquer', 'conquer'], ['nero', 'nero'], ['QuickNero', 'nero'], ['council', 'council'], ['research', 'research'], ['rag', 'rag'],
  ['mutate', 'mutate'], ['naturalize', 'naturalize'], ['sanitize', 'sanitize'], ['room', 'rooms'], ['rooms', 'rooms'], ['RoomJoin', 'rooms'], ['RoomPost', 'rooms'], ['RoomRead', 'rooms'], ['RoomWho', 'rooms'], ['RoomLock', 'rooms'], ['RoomRelease', 'rooms'], ['RoomLeave', 'rooms'], ['RoomList', 'rooms'],
  ['job', 'jobs'], ['jobs', 'jobs'], ['daemon', 'jobs'], ['JobSubmit', 'jobs'], ['JobList', 'jobs'], ['JobStatus', 'jobs'], ['JobEvents', 'jobs'], ['JobResult', 'jobs'], ['JobCancel', 'jobs'],
  ['chrome', 'browser'], ['drive', 'browser'], ['serve', 'browser'], ['ext', 'browser'], ['browser-host', 'browser'],
  ['leaderboard', 'ratings'], ['ratings', 'ratings'], ['history', 'history'], ['last', 'history'], ['provenance', 'provenance'], ['flow', 'flow'], ['flows', 'flow'], ['SaveMemory', 'memory'],
  ['worktree', 'worktrees'], ['wt', 'worktrees'], ['workspace', 'worktrees'], ['ws', 'worktrees'], ['create-skill', 'skill-authoring'],
  ['commit', 'git-actions'], ['undo', 'git-actions'], ['apply', 'forge'], ['agent-guide', 'routing-docs'], ['install-agent-prompts', 'routing-docs'],
  ['speculate', 'agent'], ['focus', 'jobs'],
  ['ProjectContext', 'rag'], ['Delegate', 'agent'],
  ['togglePlanQueued', 'plan'], ['unqueuePlan', 'plan'], ['planControl', 'plan'], ['movePlanApproval', 'plan'],
  ['forge-slice', 'forge'], ['teamforge', 'team-forge'], ['delegate', 'agent'], ['quick-fix', 'agent'], ['bug-fix', 'agent'], ['spec-first', 'plan'], ['plan-first', 'plan'], ['forge-full', 'forge'],
  ['suggest-brainstorm', 'brainstorm'], ['suggest-forge', 'forge'], ['suggest-tribunal', 'tribunal'],
]);

const supportTools = new Map([
  ['EngineReliability', '@kernlang/agon-support-engine-runtime'], ['RenderProbe', '@kernlang/agon-support-verification'], ['TuiProbe', '@kernlang/agon-support-verification'],
]);

function normalizeSurfaceId(raw) {
  return raw.replace(/^\//, '').replace(/ .*/, '');
}

function assignmentFor(category, item) {
  const raw = item.id;
  const normalized = normalizeSurfaceId(raw);
  const source = item.source ?? '';
  const physicalMod = source.match(new RegExp('^packages/mod-([^/]+)/'));
  if (physicalMod) return { class: MOD, package: '@kernlang/agon-mod-' + physicalMod[1], rule: 'physical-mod-owner' };
  const physicalSupport = source.match(/^packages\/support-([^/]+)\//);
  if (physicalSupport) return { class: SUPPORT, package: '@kernlang/agon-support-' + physicalSupport[1], rule: 'physical-support-owner' };
  if (raw === 'Pipeline' && category === 'mcpTools') return { class: MOD, package: '@kernlang/agon-mod-pipeline-orchestration', rule: 'pipeline-surface-split' };
  if (raw === 'pipeline' || raw === 'Pipeline') return { class: MOD, package: '@kernlang/agon-mod-pipeline-delivery', rule: 'pipeline-surface-split' };
  if (supportTools.has(raw)) return { class: SUPPORT, package: supportTools.get(raw), rule: 'exact-shared-tool' };
  if (kernelSurface.has(raw) || kernelSurface.has(normalized)) return { class: KERNEL, package: '@kernlang/agon-kernel', rule: 'exact-kernel-surface' };
  const modName = directMod.get(raw) ?? directMod.get(normalized);
  if (modName) return { class: MOD, package: `@kernlang/agon-mod-${modName}`, rule: 'exact-user-surface' };

  const sourceRules = [
    [/\/(?:brainstorm|team-brainstorm)\b|Brainstorm/, 'brainstorm'], [/\/(?:tribunal|team-tribunal)\b|Tribunal/, 'tribunal'],
    [/\/(?:forge|gauntlet|fitness|corpus)\b|Forge|Gauntlet|Fitness|Corpus/, 'forge'], [/\/campfire\b|Campfire/, 'campfire'],
    [/\/council\b|Council/, 'council'], [/\/nero\b|Nero/, 'nero'], [/\/synthesis\b|Synthesis/, 'synthesis'],
    [/\/review\b|Review/, 'review'], [/\/goal\b|Goal/, 'goal'], [/\/conquer\b|Conquer/, 'conquer'],
    [/\/research\b|Research/, 'research'], [/\/rag\b|Rag|RAG/, 'rag'], [/\/rooms\b|Room/, 'rooms'],
    [/\/job|Job/, 'jobs'], [/\/provenance\b|Provenance/, 'provenance'], [/\/ratings|Glicko|Rating/, 'ratings'],
    [/\/mutate|Mutat/, 'mutate'], [/\/naturalize|Natural/, 'naturalize'], [/\/agent-|\/agent\b|Agent/, 'agent'],
  ];
  for (const [pattern, name] of sourceRules) {
    if (pattern.test(source) || pattern.test(raw)) return { class: MOD, package: `@kernlang/agon-mod-${name}`, rule: 'semantic-source-rule' };
  }
  if (/engine|dispatch|adapter|model|auth/i.test(raw) || /engine|dispatch|adapter|api\/dispatch|auth-store|models-registry/i.test(source)) {
    return { class: SUPPORT, package: '@kernlang/agon-support-engine-runtime', rule: 'engine-runtime-rule' };
  }
  if (/worktree|workspace/i.test(raw) || /worktree|workspace/i.test(source)) return { class: SUPPORT, package: '@kernlang/agon-support-worktree', rule: 'worktree-support-rule' };
  if (/verdict|verification|guard|diagnostic|fitness|probe/i.test(raw) || /guard|diagnostic|verification|tool-(?:read|write|edit|bash|grep|glob)/i.test(source)) {
    return { class: SUPPORT, package: '@kernlang/agon-support-verification', rule: 'verification-support-rule' };
  }
  if (/session|store|snapshot|record|ledger|history|path|dir|home/i.test(raw) || /store|session|history|run-dir|paths/i.test(source)) {
    return { class: SUPPORT, package: '@kernlang/agon-support-persistence', rule: 'persistence-support-rule' };
  }
  if (/dedup/i.test(raw) || /dedup/i.test(source)) return { class: SUPPORT, package: '@kernlang/agon-support-dedup', rule: 'dedup-support-rule' };
  if (/browser|chrome|native-host/i.test(raw) || /bridge|browser-host/i.test(source)) return { class: SUPPORT, package: '@kernlang/agon-support-browser-bridge', rule: 'browser-support-rule' };
  if (/packages\/saas-api/.test(source) || /packages\/saas-api/.test(raw)) return { class: SUPPORT, package: '@kernlang/agon-support-saas-api', rule: 'saas-source-rule' };
  if (frozenKernelDefaults.has(semanticKey(category, item))) {
    return { class: KERNEL, package: '@kernlang/agon-kernel', rule: 'kernel-contract-default' };
  }
  throw new Error('unclassified modular surface: ' + occurrenceKey(category, item));
}

const ownership = [];
for (const [category, items] of Object.entries(inventory.categories)) {
  for (const item of items) ownership.push({ category, id: item.id, source: item.source, ...assignmentFor(category, item) });
}

const dependencyEdges = packages.flatMap((pkg) => pkg.dependencies.map((dependency) => ({ from: pkg.id, to: dependency, kind: 'hard' })));
const packageMap = { schemaVersion: 1, packages, dependencyEdges };
writeFileSync(join(evidenceDir, 'modular-agon-package-map.json'), `${JSON.stringify(packageMap, null, 2)}\n`);
writeFileSync(join(evidenceDir, 'modular-agon-ownership.json'), `${JSON.stringify({ schemaVersion: 1, assignments: ownership }, null, 2)}\n`);

const uiHierarchy = {
  schemaVersion: 1,
  groups: [
    { id: 'work', label: 'Work', children: ['ask', 'think', 'plan', 'agent', 'goal', 'conquer'] },
    { id: 'create', label: 'Create and compete', children: ['brainstorm', { id: 'team-brainstorm', parent: 'brainstorm' }, 'campfire', 'forge', { id: 'team-forge', parent: 'forge' }, 'synthesis', 'pipeline-orchestration', 'pipeline-delivery'] },
    { id: 'judge', label: 'Review and decide', children: ['review', 'tribunal', { id: 'team-tribunal', parent: 'tribunal' }, 'council', 'nero'] },
    { id: 'knowledge', label: 'Knowledge', children: ['research', 'rag', 'memory', 'history', 'provenance', 'flow'] },
    { id: 'transform', label: 'Transform', children: ['mutate', 'naturalize', 'sanitize'] },
    { id: 'collaborate', label: 'Collaborate and automate', children: ['rooms', 'jobs', 'worktrees', 'git-actions'] },
    { id: 'interfaces', label: 'Interfaces', children: ['browser', 'ratings', 'skill-authoring', 'routing-docs'] },
    { id: 'manage', label: 'Kernel management', children: ['engines', 'providers', 'configuration', 'permissions', 'diagnostics', 'updates'], nonToggleable: true },
  ],
  disabledPresentation: { visible: true, style: 'greyed', reasonAndDependencyActionRequired: true },
};
writeFileSync(join(evidenceDir, 'modular-agon-ui-hierarchy.json'), `${JSON.stringify(uiHierarchy, null, 2)}\n`);

const killList = {
  schemaVersion: 1,
  entries: [
    { id: 'KL-001', target: 'packages/cli/src/lazy-commands.ts static mode imports/map', replacement: 'resolver-built command registry', phase: 'surface-cutover' },
    { id: 'KL-002', target: 'packages/core/src/blocks/builtin-commands.ts monolithic builtins array', replacement: 'kernel commands plus manifest contributions', phase: 'surface-cutover' },
    { id: 'KL-003', target: 'packages/cli/src/signals/intent.ts monolithic slash switch', replacement: 'registry-owned parsers with kernel fallback', phase: 'surface-cutover' },
    { id: 'KL-004', target: 'packages/cli/src/cesar/tools.ts hard-coded registry', replacement: 'capability registry assembled from resolved mods', phase: 'runtime-cutover' },
    { id: 'KL-005', target: 'packages/mcp/src/agon-orchestration.ts static tool arrays and dispatch switch', replacement: 'MCP projection of resolved capabilities', phase: 'surface-cutover' },
    { id: 'KL-006', target: 'packages/core/src/blocks/extension-loader.ts legacy extension discovery/last-wins registration', replacement: 'trusted deterministic mod resolver', phase: 'resolver-cutover' },
    { id: 'KL-007', target: 'packages/cli/tsup.config.ts feature chunks and duplicated engine copies', replacement: 'kernel bundle plus physical first-party mod packages', phase: 'packaging-cutover' },
    { id: 'KL-008', target: 'root postinstall patch-package and optional Python install side effects', replacement: 'explicit transactional setup actions with receipts', phase: 'install-cutover' },
    { id: 'KL-009', target: 'global updater npm install -g in active process', replacement: 'candidate-prefix qualification and atomic promotion', phase: 'update-cutover' },
    { id: 'KL-010', target: 'project .agon.json activation semantics', replacement: 'user-global activation; project settings-only validation', phase: 'config-cutover' },
    { id: 'KL-011', target: 'independent CLI/TUI/MCP/Cesar command catalogs', replacement: 'one manifest capability projected to every surface', phase: 'surface-cutover' },
    { id: 'KL-012', target: 'ambiguous pipeline name (MCP brainstorm→forge→tribunal vs TUI build→review→fix)', replacement: 'separate stable workflow ids with compatibility aliases per surface', phase: 'workflow-cutover' },
    { id: 'KL-013', target: 'unversioned persisted mode-specific result shapes', replacement: 'versioned plan/result/session envelopes with migrations', phase: 'state-cutover' },
    { id: 'KL-014', target: 'implicit hook permissions and fail-open extension loading', replacement: 'declared capabilities, grants, trust records, and journaled activation', phase: 'security-cutover' },
    { id: 'KL-015', target: 'generated docs maintained from separate source lists', replacement: 'resolved manifest catalog generator with handwritten-region preservation', phase: 'docs-cutover' },
  ],
};
writeFileSync(join(evidenceDir, 'modular-agon-migration-kill-list.json'), `${JSON.stringify(killList, null, 2)}\n`);

const summary = {
  assignments: ownership.length,
  byClass: Object.fromEntries([KERNEL, SUPPORT, MOD].map((kind) => [kind, ownership.filter((entry) => entry.class === kind).length])),
  packages: packages.length,
  dependencyEdges: dependencyEdges.length,
  mods: packages.filter((pkg) => pkg.class === MOD).length,
};
console.log(JSON.stringify(summary, null, 2));
