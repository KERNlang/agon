import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const legacyPath = 'packages/cli/src/signals/runs-store.ts';
const owner = '@kernlang/agon-support-persistence';
const implementationPath = 'packages/support-persistence/src/runs-store.ts';
const removalEvidence = 'tests/unit/modular-runs-store-owner.test.ts';
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

// Keep historical extraction occurrences after an internal adapter is removed.
export function collectSupportSourceRelocations(root, packages) {
  if (existsSync(join(root, legacyPath))) return [];
  return packages.flatMap(pkg => pkg.extractionSources
    .filter(source => source.replace(/:\d+$/, '') === legacyPath)
    .map(source => {
      if (pkg.id !== owner) throw new Error(`support relocation has wrong owner: ${pkg.id}`);
      return {
        package: owner, source, legacyPresent: false,
        implementationPaths: [implementationPath],
        implementationHash: sha256(readFileSync(join(root, implementationPath))),
        removalEvidence,
        removalEvidenceHash: sha256(readFileSync(join(root, removalEvidence))),
      };
    }));
}
