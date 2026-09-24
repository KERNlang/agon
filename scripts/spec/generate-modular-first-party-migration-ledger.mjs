import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const ownership = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-ownership.json'), 'utf8'));
const packageMap = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const outputPath = resolve(root, 'docs/specs/evidence/modular-agon-slice5-migration-ledger.json');
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const sourcePath = (locator) => locator.replace(/:\d+(?::\d+)?$/, '');
const shortName = (id) => id.replace('@kernlang/agon-mod-', '');
const packages = packageMap.packages.filter(({ class: kind }) => kind === 'user-toggleable-mod-package');
const packageIds = new Set(packages.map(({ id }) => id));
const removedLegacyEvidence = new Map([
  ['packages/cli/src/commands/agent-guide-text.ts', 'KL-015'],
  ['packages/core/src/rooms/types.ts', 'tests/unit/modular-no-legacy-orchestration-owner.test.ts:physical-room-owner'],
  ['packages/core/src/rooms/leases.ts', 'tests/unit/modular-no-legacy-orchestration-owner.test.ts:physical-room-owner'],
  ['packages/core/src/rooms/presence.ts', 'tests/unit/modular-no-legacy-orchestration-owner.test.ts:physical-room-owner'],
  ['packages/core/src/rooms/store.ts', 'tests/unit/modular-no-legacy-orchestration-owner.test.ts:physical-room-owner'],
  ['packages/core/src/rooms/tail.ts', 'tests/unit/modular-no-legacy-orchestration-owner.test.ts:physical-room-owner'],
]);

const assignments = ownership.assignments
  .filter(({ package: owner }) => packageIds.has(owner))
  .map((assignment) => {
    const short = shortName(assignment.package);
    const legacyPath = sourcePath(assignment.source);
    const legacyPresent = existsSync(resolve(root, legacyPath));
    const removalEvidence = removedLegacyEvidence.get(legacyPath);
    if (!legacyPresent && !removalEvidence) throw new Error(`missing legacy assignment source without removal evidence ${assignment.source}`);
    const packageRoot = `packages/mod-${short}`;
    const physicalEntrypoint = `${packageRoot}/src/index.ts`;
    const ownershipAsset = `${packageRoot}/ownership.json`;
    for (const path of [physicalEntrypoint, ownershipAsset, `${packageRoot}/agon.mod.json`]) {
      if (!existsSync(resolve(root, path))) throw new Error(`${assignment.package}: missing physical destination ${path}`);
    }
    const implementationPaths = short === 'rag' && legacyPath === 'packages/core/src/rag/store.ts'
      ? [`${packageRoot}/src/store.ts`, `${packageRoot}/src/types.ts`]
      : short === 'rag' && legacyPath === 'packages/core/src/rag/types.ts'
        ? [`${packageRoot}/src/types.ts`]
        : [physicalEntrypoint];
    return Object.freeze({
      ...assignment,
      legacyPath,
      physicalPackage: packageRoot,
      physicalEntrypoint,
      implementationPaths,
      ownershipAsset,
      compatibilityAdapter: legacyPresent ? legacyPath : null,
      authority: legacyPresent ? 'legacy-runtime-until-s6' : 'physical-owner',
      legacyPresent,
      ...(!legacyPresent ? { removalEvidence } : {}),
      registrationBoundary: 'public-mod-api',
      removalCondition: 'S6 generated registry owns the contribution and its frozen oracle remains green',
    });
  })
  .sort((a, b) => a.package.localeCompare(b.package) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id) || a.source.localeCompare(b.source));

const categoryCounts = Object.fromEntries([...new Set(assignments.map(({ category }) => category))]
  .sort()
  .map((category) => [category, assignments.filter((entry) => entry.category === category).length]));
const packageRecords = packages.map(({ id, dependencies }) => {
  const owned = assignments.filter(({ package: owner }) => owner === id);
  const manifest = JSON.parse(readFileSync(resolve(root, `packages/mod-${shortName(id)}/agon.mod.json`), 'utf8'));
  return {
    id,
    modId: manifest.id,
    dependencies,
    assignments: owned.length,
    assignmentHash: sha256(JSON.stringify(owned)),
    compatibilityAdapter: 'legacy runtime injected per invocation; no global bridge',
    rollback: 'select the retained S4 subject; legacy runtime remains authoritative',
  };
});
const document = {
  schemaVersion: 1,
  slice: 'S5',
  authority: 'legacy-runtime-until-s6',
  packages: packageRecords,
  assignments,
  counts: { packages: packages.length, assignments: assignments.length, categories: categoryCounts },
};
const text = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== text) {
    throw new Error('S5 migration ledger is missing or stale; run generator');
  }
  console.log(`S5 migration ledger verified: ${packages.length} packages, ${assignments.length} assignments`);
} else {
  writeFileSync(outputPath, text);
  console.log(`wrote ${outputPath}: ${packages.length} packages, ${assignments.length} assignments`);
}
