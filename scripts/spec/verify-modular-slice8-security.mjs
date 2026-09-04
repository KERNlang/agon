import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const files = Object.freeze({
  discovery: 'packages/mod-kernel/src/discovery.ts',
  bounds: 'packages/mod-kernel/src/folder-mod-bounds.ts',
  boundedWork: 'packages/mod-kernel/src/bounded-work.ts',
  diagnostics: 'packages/mod-kernel/src/folder-mod-diagnostics.ts',
  activationState: 'packages/mod-kernel/src/external-activation-state.ts',
  folders: 'packages/mod-kernel/src/folder-mods.ts',
  snapshot: 'packages/mod-kernel/src/folder-mod-snapshot.ts',
  trust: 'packages/mod-kernel/src/trust-authority.ts',
  transaction: 'packages/mod-kernel/src/transactional-authority.ts',
  activation: 'packages/mod-kernel/src/third-party-activation.ts',
  manager: 'packages/mod-kernel/src/folder-mod-manager.ts',
  ui: 'packages/mod-kernel/src/mod-management-ui.ts',
  lifecycle: 'packages/mod-kernel/src/managed-lifecycle.ts',
  bootstrap: 'packages/mod-kernel/src/first-party-surface-bootstrap.ts',
  services: 'packages/mod-kernel/src/external-mod-services-safe.ts',
  resolver: 'packages/mod-kernel/src/external-resolution.ts',
  mcp: 'packages/mcp/src/surface-authority.ts',
  cesar: 'packages/cli/src/cesar/tools.ts',
  externalCatalog: 'packages/mod-kernel/src/external-surface-catalog.ts',
  cli: 'packages/cli/src/commands/mod.ts',
  example: 'docs/examples/hello-folder-mod/README.md',
  qualifier: 'scripts/spec/qualify-modular-agon-slice8.mjs',
});

const requirements = Object.freeze([
  ['dangerous-json-keys', 'discovery', "'__proto__', 'prototype', 'constructor'"],
  ['bounded-json-depth', 'discovery', 'MAX_JSON_DEPTH'],
  ['symlink-refusal', 'bounds', 'symbolic links are forbidden'],
  ['archive-refusal', 'bounds', 'nested archives are forbidden'],
  ['bounded-folder-bytes', 'bounds', 'maxTotalBytes'],
  ['bounded-inspection-concurrency', 'boundedWork', 'Math.min(concurrency, values.length)'],
  ['isolated-discovery-diagnostics', 'diagnostics', 'FolderModDiagnostic'],
  ['undeclared-file-refusal', 'folders', 'folder mod contains undeclared files'],
  ['nofollow-copy', 'snapshot', 'constants.O_NOFOLLOW'],
  ['independent-snapshot-hash', 'snapshot', 'snapshot.contentHash !== current.contentHash'],
  ['exact-trust-hash', 'trust', 'record.contentHash === artifact.contentHash'],
  ['publisher-binding', 'trust', 'samePublisher(record.publisher, artifact.publisher)'],
  ['approval-plan-binding', 'trust', 'authority approval does not match the exact plan'],
  ['single-writer-fence', 'transaction', 'WriterFence.acquire'],
  ['authority-journal', 'transaction', "kind: 'authority'"],
  ['edited-dev-content-invalidates-trust', 'trust', '&& record.contentHash === artifact.contentHash'],
  ['authority-recovery', 'transaction', 'recovered-rolled-back'],
  ['authority-journal-path-containment', 'transaction', 'record path escaped its owned authority directory'],
  ['safe-mode-denial', 'activation', 'kernel-only safe mode forbids third-party activation'],
  ['bounded-activation', 'activation', 'third-party activation timed out'],
  ['owner-cleanup', 'activation', 'disposeOwner'],
  ['capability-decision-receipt', 'activation', "'capability-decision'"],
  ['separate-activation-state', 'activationState', 'ExternalActivationStore'],
  ['strict-activation-journal-shape', 'activationState', 'Object.keys(input).length !== fields.length'],
  ['owner-scoped-durable-state', 'services', 'external-mod-data'],
  ['operator-backend', 'manager', 'previewApproval'],
  ['full-code-warning', 'manager', 'worker isolation is a termination boundary, not a sandbox'],
  ['visible-trust-ui', 'ui', 'Trust:'],
  ['visible-permissions-ui', 'ui', 'Permissions:'],
  ['persisted-authority-proof', 'lifecycle', 'backed by an exact immutable record'],
  ['trusted-process-bootstrap', 'bootstrap', 'prepareTrustedFolderMod'],
  ['safe-mode-early-branch', 'bootstrap', 'if (options.safeMode) {'],
  ['safe-mode-kernel-generation', 'bootstrap', "id: 'kernel-safe-mode'"],
  ['safe-mode-kernel-catalog-only', 'bootstrap', 'catalog: KERNEL_MANAGEMENT_SURFACE_CATALOG'],
  ['safe-mode-no-mod-packages', 'bootstrap', 'packages: []'],
  ['safe-mode-no-external-discovery', 'bootstrap', 'externalDiagnostics: Object.freeze([])'],
  ['canonical-external-resolution', 'resolver', 'resolveCandidates'],
  ['mcp-safe-mode-propagation', 'mcp', "AGON_MOD_SAFE_MODE === '1'"],
  ['mcp-dynamic-invocation', 'mcp', 'invokeActiveMcpSurfaceTool'],
  ['cesar-dynamic-invocation', 'cesar', "record.kind !== 'cesar-tool'"],
  ['external-registry-projection', 'externalCatalog', 'createExternalSurfaceCatalog'],
  ['exact-cli-plan-approval', 'cli', 'folder mod changed after authority preview'],
  ['separate-cli-activation', 'cli', 'enable: activationCommand(true)'],
  ['explicit-cli-grants', 'cli', 'args.allow'],
  ['visible-authority-recovery', 'cli', 'Authority state is unreadable'],
  ['public-api-only-example', 'example', 'public `@kernlang/agon-mod-api`'],
  ['final-ignored-contamination-scan', 'qualifier', "id: 'final-ignored-source-contamination'"],
]);

function verify(contents) {
  return requirements.map(([id, file, token]) => ({ id, passed: contents[file].includes(token), file: files[file] }));
}

const contents = Object.fromEntries(Object.entries(files).map(([id, path]) => [id, readFileSync(resolve(root, path), 'utf8')]));
const checks = verify(contents);
if (process.argv.includes('--self-test')) {
  for (const [id, file, token] of requirements) {
    const mutated = { ...contents, [file]: contents[file].replaceAll(token, `MUTATED_${id}`) };
    const result = verify(mutated).find((check) => check.id === id);
    if (!result || result.passed) throw new Error(`negative control survived: ${id}`);
  }
}
const result = { schemaVersion: 1, verifier: 'modular-agon-slice8-structural-drift', claim: 'structural-drift-only; behavioral security is enforced by test:modular-slice8', checks, negativeControls: process.argv.includes('--self-test') ? requirements.length : 0, passed: checks.every(({ passed }) => passed) };
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
