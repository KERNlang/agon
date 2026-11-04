import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CoverageLedgerSchema } from '../../docs/specs/fixtures/modular-agon-contracts/contracts.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'docs/specs/evidence');
mkdirSync(out, { recursive: true });

const lifecycles = [
  ['discover', 'runtime-contract.md#manifest-v2'], ['validate', 'runtime-contract.md#manifest-v2'], ['trust-and-grant', 'security-and-distribution.md#permission-model'],
  ['resolve', 'blast-radius-and-readiness.md#deterministic-resolver'], ['plan-transaction', 'runtime-contract.md#phase-1-plan'], ['stage', 'runtime-contract.md#phase-2-apply'],
  ['verify-candidate', 'migration-and-verification.md#required-per-mod-contract'], ['commit-activation', 'runtime-contract.md#activation-transaction'],
  ['boot', 'blast-radius-and-readiness.md#boot-containment-and-safe-mode'], ['register-surfaces', 'runtime-contract.md#surface-contribution-contracts'],
  ['invoke', 'runtime-contract.md#mod-registration-api'], ['persist', 'runtime-contract.md#result-and-lifecycle'], ['disable', 'runtime-contract.md#enable-and-disable-behavior'],
  ['drain', 'overview.md#dependency-and-activation-semantics'], ['update', 'security-and-distribution.md#updates-and-rollback'], ['rollback', 'security-and-distribution.md#updates-and-rollback'],
  ['remove', 'blast-radius-and-readiness.md#persistence-and-removal-clauses'], ['export-import', 'overview.md#installation-and-wizard-experience'],
  ['safe-mode-recover', 'blast-radius-and-readiness.md#boot-containment-and-safe-mode'], ['generate-docs', 'runtime-contract.md#docshelp'],
];
const artifacts = [
  ['manifest', '@kernlang/agon-mod-api'], ['package', '@kernlang/agon-mod-api'], ['executable-entrypoints', '@kernlang/agon-mod-api'], ['dependency-closure', '@kernlang/agon-kernel'],
  ['desired-state', '@kernlang/agon-kernel'], ['profile-metadata', '@kernlang/agon-kernel'], ['canonical-lock', '@kernlang/agon-kernel'], ['current-generation-pointer', '@kernlang/agon-kernel'],
  ['transaction-journal', '@kernlang/agon-kernel'], ['trust-record', '@kernlang/agon-kernel'], ['grant-record', '@kernlang/agon-kernel'], ['quarantine-record', '@kernlang/agon-kernel'],
  ['verification-contract', '@kernlang/agon-support-verification'], ['verification-receipt', '@kernlang/agon-support-verification'],
  ['plan-envelope', '@kernlang/agon-support-persistence'], ['result-envelope', '@kernlang/agon-support-persistence'], ['session-envelope', '@kernlang/agon-support-persistence'], ['job-envelope', '@kernlang/agon-support-persistence'],
  ['ratings-record', '@kernlang/agon-mod-ratings'], ['history-record', '@kernlang/agon-mod-history'], ['config-state', '@kernlang/agon-kernel'], ['migration-backup', '@kernlang/agon-kernel'], ['tombstone', '@kernlang/agon-support-persistence'],
  ['generation-lease', '@kernlang/agon-kernel'], ['gc-index', '@kernlang/agon-kernel'], ['download-cache', '@kernlang/agon-kernel'], ['setup-action-output', '@kernlang/agon-kernel'],
  ['provenance-attestation', '@kernlang/agon-mod-provenance'], ['static-assets', '@kernlang/agon-mod-api'], ['native-sidecars', '@kernlang/agon-support-verification'],
  ['registry-catalog', '@kernlang/agon-kernel'], ['registry-cli-projection', '@kernlang/agon-kernel'], ['registry-tui-projection', '@kernlang/agon-kernel'],
  ['registry-mcp-projection', '@kernlang/agon-kernel'], ['registry-cesar-projection', '@kernlang/agon-kernel'], ['package-map', '@kernlang/agon-kernel'], ['generated-docs', '@kernlang/agon-mod-routing-docs'],
];
const relevant = new Map([
  ['discover', new Set(['manifest', 'package', 'registry-catalog', 'static-assets', 'native-sidecars'])],
  ['validate', new Set(artifacts.map(([id]) => id))], ['trust-and-grant', new Set(['manifest', 'package', 'trust-record', 'grant-record', 'static-assets', 'native-sidecars'])],
  ['resolve', new Set(['manifest', 'desired-state', 'canonical-lock', 'registry-catalog', 'package-map', 'config-state'])],
  ['plan-transaction', new Set(['desired-state', 'canonical-lock', 'transaction-journal', 'trust-record', 'grant-record', 'verification-contract'])],
  ['stage', new Set(['package', 'canonical-lock', 'transaction-journal', 'static-assets', 'native-sidecars'])],
  ['verify-candidate', new Set(['manifest', 'package', 'canonical-lock', 'verification-contract', 'verification-receipt', 'static-assets', 'native-sidecars'])],
  ['commit-activation', new Set(['desired-state', 'canonical-lock', 'transaction-journal', 'trust-record', 'grant-record', 'registry-catalog'])],
  ['boot', new Set(['canonical-lock', 'transaction-journal', 'trust-record', 'grant-record', 'registry-catalog', 'config-state', 'static-assets', 'native-sidecars'])],
  ['register-surfaces', new Set(['manifest', 'canonical-lock', 'registry-catalog', 'package-map', 'generated-docs'])],
  ['invoke', new Set(['manifest', 'grant-record', 'verification-contract', 'verification-receipt', 'plan-envelope', 'result-envelope', 'session-envelope', 'config-state', 'native-sidecars'])],
  ['persist', new Set(['canonical-lock', 'transaction-journal', 'trust-record', 'grant-record', 'verification-receipt', 'plan-envelope', 'result-envelope', 'session-envelope', 'config-state'])],
  ['disable', new Set(['desired-state', 'canonical-lock', 'transaction-journal', 'registry-catalog', 'generated-docs'])],
  ['drain', new Set(['canonical-lock', 'transaction-journal', 'plan-envelope', 'result-envelope', 'session-envelope'])],
  ['update', new Set(['manifest', 'package', 'desired-state', 'canonical-lock', 'transaction-journal', 'trust-record', 'grant-record', 'verification-contract', 'verification-receipt', 'static-assets', 'native-sidecars'])],
  ['rollback', new Set(['package', 'desired-state', 'canonical-lock', 'transaction-journal', 'trust-record', 'grant-record', 'verification-receipt', 'config-state', 'static-assets', 'native-sidecars'])],
  ['remove', new Set(['package', 'desired-state', 'canonical-lock', 'transaction-journal', 'trust-record', 'grant-record', 'plan-envelope', 'result-envelope', 'session-envelope', 'static-assets', 'native-sidecars'])],
  ['export-import', new Set(['desired-state', 'config-state', 'package-map'])], ['safe-mode-recover', new Set(['canonical-lock', 'transaction-journal', 'registry-catalog', 'config-state'])],
  ['generate-docs', new Set(['manifest', 'canonical-lock', 'registry-catalog', 'package-map', 'generated-docs'])],
]);

const executableArtifacts = new Set(['manifest', 'canonical-lock', 'transaction-journal', 'trust-record', 'grant-record', 'verification-contract', 'verification-receipt', 'plan-envelope', 'result-envelope', 'session-envelope']);
const measuredMacLifecycles = new Set(['boot', 'invoke', 'verify-candidate']);
const cells = [];
for (const [lifecycle, clause] of lifecycles) {
  for (const [artifact, owner] of artifacts) {
    for (const platform of ['darwin', 'linux']) {
      const applies = relevant.get(lifecycle).has(artifact);
      let status = 'specified'; let evidenceId = 'EVIDENCE-NORMATIVE-NO-MUTATION';
      if (applies) {
        if (platform === 'darwin' && measuredMacLifecycles.has(lifecycle)) { status = 'measured'; evidenceId = 'EVIDENCE-MACOS-BASELINE'; }
        else if (platform === 'linux' && ['boot', 'invoke', 'stage', 'verify-candidate', 'commit-activation', 'update', 'rollback', 'native-sidecars'].includes(lifecycle)) { status = 'blocked'; evidenceId = 'BLOCK-EXTERNAL-LINUX-RUNNER'; }
        else if (executableArtifacts.has(artifact) && ['validate', 'resolve', 'plan-transaction'].includes(lifecycle)) { status = 'tested'; evidenceId = 'TEST-CONTRACTS-AND-RESOLVER'; }
        else { status = 'specified'; evidenceId = 'EVIDENCE-NORMATIVE-SPEC'; }
      }
      cells.push({ lifecycle, artifact, owner, normativeClause: `docs/specs/modular-agon-${clause}`, evidenceId, platform, status });
    }
  }
}
const ledger = CoverageLedgerSchema.parse({ schemaVersion: 1, generatedAt: new Date().toISOString(), cells });
writeFileSync(join(out, 'modular-agon-lifecycle-artifact-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
const counts = {};
for (const cell of cells) counts[cell.status] = (counts[cell.status] ?? 0) + 1;
writeFileSync(join(out, 'modular-agon-lifecycle-artifact-ledger.md'), `# Modular Agon lifecycle × artifact ledger\n\n> Generated evidence; ${cells.length} cells (${lifecycles.length} lifecycle stages × ${artifacts.length} artifacts × 2 platforms).\n\n| Status | Cells |\n|---|---:|\n${Object.entries(counts).map(([status, count]) => `| ${status} | ${count} |`).join('\n')}\n\nCanonical ledger: [modular-agon-lifecycle-artifact-ledger.json](./modular-agon-lifecycle-artifact-ledger.json).\n`);
console.log(JSON.stringify({ cells: cells.length, counts }, null, 2));
