import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const absent = (text, expressions) => expressions.every((expression) => !expression.test(text));
const present = (text, expressions) => expressions.every((expression) => expression.test(text));

export function evaluateKillList(files) {
  const lazy = files['packages/cli/src/lazy-commands.ts'];
  const builtins = files['packages/core/src/blocks/builtin-commands.ts'];
  const intent = files['packages/cli/src/signals/intent.ts'];
  const cesar = files['packages/cli/src/cesar/tools.ts'];
  const mcp = files['packages/mcp/src/agon-orchestration.ts'];
  const extension = files['packages/core/src/blocks/extension-loader.ts'] ?? '';
  const cliBuild = files['packages/cli/tsup.config.ts'];
  const rootPackage = JSON.parse(files['package.json']);
  const update = files['packages/cli/src/commands/update.ts'];
  const managedSetup = files['packages/cli/src/commands/setup.ts'];
  const desired = files['packages/mod-kernel/src/desired-state.ts'];
  const pipelineOrchestration = files['packages/mod-pipeline-orchestration/src/implementation.ts'];
  const pipelineDelivery = files['packages/mod-pipeline-delivery/src/implementation.ts'];
  const envelopes = files['packages/mod-api/src/envelopes.ts'];
  const envelopeCodec = files['packages/support-persistence/src/persisted-envelope.ts'];
  const envelopeProducers = [
    'packages/support-persistence/src/plan-store.ts', 'packages/support-persistence/src/session-store.ts',
    'packages/support-persistence/src/chat-store.ts', 'packages/mod-jobs/src/implementation.ts',
    'packages/mod-goal/src/implementation.ts', 'packages/forge/src/result-envelope.ts',
  ].map((path) => files[path]).join('\n');
  const envelopeTests = files['tests/unit/modular-envelope-contract.test.ts'] + files['tests/unit/modular-release-state-migrations.test.ts'];
  const bootstrap = files['packages/mod-kernel/src/first-party-surface-bootstrap.ts'];
  const docsRenderer = files['packages/mod-routing-docs/src/guide-content.ts'];
  const docsEntrypoint = files['scripts/generate-mode-docs.mjs'];
  const legacyDocsSource = files['packages/cli/src/commands/agent-guide-text.ts'] ?? '';
  const docsAdapter = JSON.parse(files['docs/specs/evidence/modular-agon-slice6-compatibility-adapters.json']);

  const rows = [
    ['KL-001', absent(lazy, [/legacyLazyCommandImplementations/, /lazyCommand\(\(\) => import\('\.\/commands\/(?:ask|brainstorm|forge|goal|research|room|sanitize)/]) && present(lazy, [/kernelLazyCommandImplementations/, /schemaGeneratedCommand/])],
    ['KL-002', present(builtins, [/FIRST_PARTY_SURFACE_CATALOG/, /\.filter\(\(entry\) => entry\.category === 'builtinCommandMetadata'/]) && absent(builtins, [/const\s+builtins\s*=\s*\[/])],
    ['KL-003', absent(intent, [/switch\s*\(cmd\)/, /case\s+['"](?:forge|brainstorm|tribunal|review|goal|conquer)['"]/, /parseForgeInput|parseReviewInput/]) && present(intent, [/parseProcessFirstPartyIntent\(cmd, input\)/, /parseKernelSlashCommand/])],
    ['KL-004', absent(cesar, [/CESAR_SURFACE_IDS/, /register\(create(?:Read|Edit|Write|Bash|Forge|Brainstorm|Tribunal)Tool/]) && present(cesar, [/processSurfaceClient\('cesar'\)/])],
    ['KL-005', absent(mcp, [/ORCHESTRATION_TOOLS/, /handleToolCall\(/, /handleWriteToolCall\(/]) && present(mcp, [/invokeDynamic\(/])],
    ['KL-006', extension.length === 0 && present(bootstrap, [/discoverUserFolderModsDetailed/, /resolveExternalFolderModsIsolated/])],
    ['KL-007', absent(cliBuild, [/chunks\/forge/, /chunks\/brainstorm/, /chunks\/tribunal/, /copy.*engines/i])],
    ['KL-008', !rootPackage.scripts?.postinstall && !rootPackage.scripts?.prepare && files['scripts/postinstall.mjs'] === undefined],
    ['KL-009', absent(update, [/["']install["']\s*,\s*["']-g["']/, /npm install -g/]) && present(update, [/runManagedSetup/, /preserveExistingState:\s*true/]) && present(managedSetup, [/ManagedLifecycleService/, /runBoundedCandidateProcess/])],
    ['KL-010', present(desired, [/REPOSITORY_ACTIVATION_FORBIDDEN/, /cannot come from repository configuration/])],
    ['KL-011', absent(lazy + intent + cesar + mcp, [/legacyLazyCommandImplementations/, /switch\s*\(cmd\)/, /CESAR_SURFACE_IDS/, /ORCHESTRATION_TOOLS/])],
    ['KL-012', present(pipelineOrchestration, [/agon\.workflow\.pipeline-orchestration\.v1/, /mcp:Pipeline/, /brainstorm/, /forge/, /tribunal/]) && present(pipelineDelivery, [/agon\.workflow\.pipeline-delivery\.v1/, /tui:\/pipeline/, /cesar:pipeline/, /build/, /review/, /fix/])],
    ['KL-013', present(envelopes, [/PlanEnvelopeSchema/, /ResultEnvelopeSchema/, /SessionEnvelopeSchema/, /JobEnvelopeSchema/, /\.strict\(\)/]) && present(envelopeCodec, [/createPersistenceEnvelope/, /unwrapPersistenceEnvelope/, /validatePersistedEnvelope/]) && present(envelopeProducers, [/kind:\s*['"]plan['"]/, /kind:\s*['"]session['"]/, /kind:\s*['"]job['"]/, /kind:\s*['"]result['"]/]) && present(envelopeTests, [/legacy/i, /validatePersistedEnvelope|wrong envelope kind|reject/i])],
    ['KL-014', present(bootstrap, [/TrustGrantStore/, /evaluateThirdPartyAuthority/, /createSafeExternalModServices/]) && absent(extension, [/fail.open|catch\s*\{\s*return\s*\[/i])],
    ['KL-015', docsAdapter.adapters.every((adapter) => adapter.id !== 's6-mode-docs-renderer') && legacyDocsSource.length === 0 && present(docsRenderer, [/renderModeDocsProjection/, /BEGIN HANDWRITTEN/, /surface === 'docs'/]) && present(docsEntrypoint, [/renderModeDocsProjection/, /first-party-surface-catalog/, /existing/])],
  ].map(([id, removed]) => ({ id, removed: Boolean(removed) }));
  return rows;
}

const paths = [
  'packages/cli/src/lazy-commands.ts', 'packages/core/src/blocks/builtin-commands.ts', 'packages/cli/src/signals/intent.ts',
  'packages/cli/src/cesar/tools.ts', 'packages/mcp/src/agon-orchestration.ts', 'packages/core/src/blocks/extension-loader.ts',
  'packages/cli/tsup.config.ts', 'package.json', 'packages/cli/src/commands/update.ts', 'packages/cli/src/commands/setup.ts', 'packages/mod-kernel/src/desired-state.ts',
  'packages/mod-pipeline-orchestration/src/implementation.ts', 'packages/mod-pipeline-delivery/src/implementation.ts',
  'packages/mod-api/src/envelopes.ts', 'packages/support-persistence/src/persisted-envelope.ts',
  'packages/support-persistence/src/plan-store.ts', 'packages/support-persistence/src/session-store.ts', 'packages/support-persistence/src/chat-store.ts',
  'packages/mod-jobs/src/implementation.ts', 'packages/mod-goal/src/implementation.ts', 'packages/forge/src/result-envelope.ts',
  'tests/unit/modular-envelope-contract.test.ts', 'tests/unit/modular-release-state-migrations.test.ts',
  'packages/mod-routing-docs/src/guide-content.ts', 'scripts/generate-mode-docs.mjs', 'packages/cli/src/commands/agent-guide-text.ts',
  'packages/mod-kernel/src/first-party-surface-bootstrap.ts',
  'docs/specs/evidence/modular-agon-slice6-compatibility-adapters.json',
];
const files = Object.fromEntries(paths.flatMap((path) => {
  const absolute = resolve(root, path);
  return existsSync(absolute) ? [[path, read(path)]] : [];
}));
const rows = evaluateKillList(files);

if (process.argv.includes('--self-test')) {
  const controls = [
    ['KL-001', 'packages/cli/src/lazy-commands.ts', 'const legacyLazyCommandImplementations = {};'],
    ['KL-002', 'packages/core/src/blocks/builtin-commands.ts', 'const builtins = [];'],
    ['KL-003', 'packages/cli/src/signals/intent.ts', "switch (cmd) { case 'forge': return parseForgeInput(rest); }"],
    ['KL-004', 'packages/cli/src/cesar/tools.ts', 'const CESAR_SURFACE_IDS = []; register(createBrainstormTool());'],
    ['KL-005', 'packages/mcp/src/agon-orchestration.ts', 'export const ORCHESTRATION_TOOLS = []; export function handleToolCall() {}'],
    ['KL-008', 'package.json', JSON.stringify({ ...JSON.parse(files['package.json']), scripts: { postinstall: 'node scripts/postinstall.mjs' } })],
    ['KL-010', 'packages/mod-kernel/src/desired-state.ts', 'repository activation is allowed'],
    ['KL-012', 'packages/mod-pipeline-delivery/src/implementation.ts', 'const pipeline = ["build", "review", "fix"];'],
    ['KL-013', 'packages/forge/src/result-envelope.ts', 'export const legacyResult = {};'],
    ['KL-014', 'packages/mod-kernel/src/first-party-surface-bootstrap.ts', 'unsafe bootstrap'],
    ['KL-015', 'packages/mod-routing-docs/src/guide-content.ts', 'export const handwrittenDocs = [];'],
  ];
  for (const [id, path, value] of controls) {
    const fake = Object.fromEntries(Object.entries(files).map(([key, source]) => [key, source]));
    fake[path] = value;
    if (evaluateKillList(fake).find((row) => row.id === id)?.removed !== false) throw new Error(`${id} negative control did not turn the gate red`);
  }
}

const removed = rows.filter((row) => row.removed).map((row) => row.id);
const remaining = rows.filter((row) => !row.removed).map((row) => row.id);
console.log(JSON.stringify({ schemaVersion: 1, gate: 'modular-agon-legacy-kill-list', passed: remaining.length === 0,
  counts: { target: rows.length, removed: removed.length, remaining: remaining.length }, removed, remaining, rows }, null, 2));
if (remaining.length) process.exitCode = 1;
