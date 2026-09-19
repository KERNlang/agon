import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'docs/specs/fixtures');
mkdirSync(out, { recursive: true });
const hash = (char) => `sha256:${char.repeat(64)}`;
const at = '2026-08-22T12:00:00.000Z';
const ids = {
  transaction: '11111111-1111-4111-8111-111111111111', trust: '22222222-2222-4222-8222-222222222222',
  grant: '33333333-3333-4333-8333-333333333333', receipt: '44444444-4444-4444-8444-444444444444',
  envelope: '55555555-5555-4555-8555-555555555555', session: '66666666-6666-4666-8666-666666666666', trace: '77777777-7777-4777-8777-777777777777',
};
const manifest = {
  schemaVersion: 2, id: 'agon.brainstorm', name: 'Brainstorm', version: '1.0.0', apiRange: '^1.0.0', execution: 'executable',
  compatibility: { kernelRange: '^1.0.0', nodeRange: '>=22 <27' }, packageClass: 'user-toggleable-mod-package',
  entrypoints: { runtime: 'dist/index.js', types: 'dist/index.d.ts' }, display: { group: 'create', order: 20 },
  dependencies: { required: [], optional: [{ id: 'agon.team-brainstorm', range: '^1.0.0' }], conflicts: [] },
  permissions: [{ capability: 'engine.dispatch', resources: ['configured-engines'], required: true }],
  platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'],
  assets: [{ path: 'dist/index.js', kind: 'static', mediaType: 'text/javascript', contentHash: hash('2'), bytes: 128, executable: false, platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'], consumerContributionId: 'brainstorm' }],
  contributes: { cliCommands: [{ id: 'brainstorm', aliases: [] }], tuiActions: [{ id: 'brainstorm', aliases: [] }], mcpTools: [{ id: 'Brainstorm', aliases: [] }], cesarTools: [{ id: 'Brainstorm', aliases: [] }], lifecycleHooks: [], resultTypes: [{ id: 'agon.brainstorm.result.v1', aliases: [] }], configKeys: [], generatedDocs: [{ id: 'mode.brainstorm', aliases: [] }] },
  pack: { include: ['dist/index.js', 'dist/index.d.ts', 'agon.mod.json'], executable: [] },
};
const artifacts = {
  manifest,
  lock: { schemaVersion: 1, kernelVersion: '1.0.0', apiVersion: '1.0.0', desiredStateHash: hash('a'), graphHash: hash('9'), packages: [{ id: manifest.id, version: manifest.version, source: 'bundled', sourceLocator: 'npm:@kernlang/agon-mod-brainstorm@1.0.0', contentHash: hash('b'), manifestHash: hash('c'), platform: 'darwin-arm64', enabled: true, resolutionOrder: 0, dependencies: [], trustRecordId: ids.trust, grantRecordIds: [ids.grant] }] },
  journal: { schemaVersion: 1, transactionId: ids.transaction, operation: 'enable', state: 'committed', startedAt: at, updatedAt: at, baseGeneration: 41, candidateGeneration: 42, fenceToken: '88888888-8888-4888-8888-888888888888', previousLockHash: hash('d'), candidateLockHash: hash('e'), steps: [{ id: 'resolve', state: 'passed', receiptId: ids.receipt }], rollback: { attempted: false, completed: false } },
  trust: { schemaVersion: 1, recordId: ids.trust, modId: manifest.id, version: manifest.version, source: 'bundled', sourceLocator: 'npm:@kernlang/agon-mod-brainstorm@1.0.0', contentHash: hash('b'), manifestHash: hash('c'), decision: 'trusted', decidedAt: at, scope: 'exact-artifact', publisher: { registryOrigin: 'https://registry.npmjs.org', packageName: '@kernlang/agon-mod-brainstorm', provenanceIdentity: 'kernlang:first-party-release-set', provenanceStatus: 'verified' }, reason: 'first-party release artifact verified by lockstep release receipt' },
  grant: { schemaVersion: 1, recordId: ids.grant, modId: manifest.id, contentHash: hash('b'), capability: 'engine.dispatch', resources: ['configured-engines'], decision: 'allow', grantedAt: at, grantedBy: 'local-user', reason: 'approved during explicit activation plan' },
  verificationContract: { schemaVersion: 1, id: 'agon.verify.brainstorm', version: '1.0.0', owner: manifest.id, platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'], checks: [{ id: 'surface-parity', authority: 'host', kind: 'property', timeoutMs: 10000, maxOutputBytes: 1048576, evidence: ['TEST-SURFACE-PARITY'] }] },
  verificationReceipt: { schemaVersion: 1, receiptId: ids.receipt, contractId: 'agon.verify.brainstorm', contractVersion: '1.0.0', contractHash: hash('f'), subjectHash: hash('b'), runner: { id: 'agon.verify.runner', version: '1.0.0', contentHash: hash('3') }, platform: 'darwin-arm64', startedAt: at, finishedAt: at, status: 'passed', checks: [{ id: 'surface-parity', status: 'passed', exitCode: 0, durationMs: 42, evidenceHashes: [hash('1')] }] },
  planEnvelope: { schemaVersion: 1, kind: 'plan', id: ids.envelope, createdAt: at, updatedAt: at, ownerModId: 'agon.goal', ownerModVersion: '1.0.0', ownerContentHash: hash('4'), kernelVersion: '1.0.0', graphHash: hash('9'), contributionId: 'agon.goal.plan', sessionId: ids.session, traceId: ids.trace, payloadVersion: '1.0.0', payloadEncoding: 'application/json', receiptIds: [ids.receipt], status: 'approved', payload: { steps: [] } },
  resultEnvelope: { schemaVersion: 1, kind: 'result', id: ids.envelope, createdAt: at, updatedAt: at, ownerModId: manifest.id, ownerModVersion: manifest.version, ownerContentHash: hash('b'), kernelVersion: '1.0.0', graphHash: hash('9'), contributionId: 'agon.brainstorm.result', sessionId: ids.session, traceId: ids.trace, payloadVersion: '1.0.0', payloadEncoding: 'application/json', receiptIds: [ids.receipt], status: 'succeeded', payload: { groups: [] } },
  sessionEnvelope: { schemaVersion: 1, kind: 'session', id: ids.envelope, createdAt: at, updatedAt: at, ownerModId: 'agon.kernel', ownerModVersion: '1.0.0', ownerContentHash: hash('5'), kernelVersion: '1.0.0', graphHash: hash('9'), contributionId: 'agon.kernel.session', sessionId: ids.session, traceId: ids.trace, payloadVersion: '1.0.0', payloadEncoding: 'application/json', receiptIds: [ids.receipt], status: 'closed', childEnvelopeIds: [], payload: { turns: 1 } },
  jobEnvelope: { schemaVersion: 1, kind: 'job', id: ids.envelope, createdAt: at, updatedAt: at, ownerModId: 'agon.jobs', ownerModVersion: '1.0.0', ownerContentHash: hash('6'), kernelVersion: '1.0.0', graphHash: hash('9'), contributionId: 'agon.jobs.workflow', sessionId: ids.session, traceId: ids.trace, payloadVersion: '1.0.0', payloadEncoding: 'application/json', receiptIds: [ids.receipt], status: 'succeeded', leaseId: 'lease-1', payload: { kind: 'brainstorm' } },
};
writeFileSync(join(out, 'modular-agon-valid-artifacts.json'), `${JSON.stringify(artifacts, null, 2)}\n`);
writeFileSync(join(out, 'modular-agon-invalid-manifest-traversal.json'), `${JSON.stringify({ ...manifest, entrypoints: { runtime: '../escape.js', types: 'dist/index.d.ts' } }, null, 2)}\n`);
console.log('generated Modular Agon contract fixtures');
