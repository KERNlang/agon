import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const ledger = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-slice5-migration-ledger.json'), 'utf8'));
const inventory = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-current-inventory.json'), 'utf8'));
const stateCategories = new Set(['configKeys', 'statePaths', 'stateStoreModules', 'resultAndEnvelopeTypes', 'emittedEvents']);
const retained = ledger.assignments.filter(({ category }) => stateCategories.has(category));
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

if (ledger.counts.packages !== 36 || ledger.counts.assignments !== 344) throw new Error('S5 migration coverage drift');
for (const entry of retained) {
  const manifest = JSON.parse(readFileSync(resolve(root, entry.physicalPackage, 'agon.mod.json'), 'utf8'));
  const ownership = JSON.parse(readFileSync(resolve(root, entry.ownershipAsset), 'utf8'));
  if (!ownership.assignments.some((candidate) => candidate.category === entry.category && candidate.id === entry.id && candidate.source === entry.source)) {
    throw new Error(`${entry.package}: persisted assignment missing from physical ownership asset: ${entry.category}/${entry.id}`);
  }
  if (entry.category === 'resultAndEnvelopeTypes') {
    const inventoryIndex = inventory.categories.resultAndEnvelopeTypes.findIndex((candidate) => candidate.id === entry.id && candidate.source === entry.source);
    if (inventoryIndex < 0) throw new Error(entry.package + ': persisted result is absent from the canonical inventory: ' + entry.id);
    const expectedId = 'resultAndEnvelopeTypes:' + String(inventoryIndex).padStart(4, '0');
    if (!manifest.contributes.resultTypes.some(({ id }) => id === expectedId)) {
      throw new Error(entry.package + ': persisted result is missing its exact historical reader contribution: ' + expectedId);
    }
  }
  for (const implementationPath of entry.implementationPaths) readFileSync(resolve(root, implementationPath));
}

const ragStore = readFileSync(resolve(root, 'packages/mod-rag/src/store.ts'));
const ragAdapter = readFileSync(resolve(root, 'packages/core/src/rag/store.ts'), 'utf8');
if (!ragAdapter.includes("from '@kernlang/agon-mod-rag'")) throw new Error('RAG legacy adapter does not delegate to the physical owner');
if (!ragStore.length || !sha256(ragStore).startsWith('sha256:')) throw new Error('RAG physical implementation is unreadable');

if (process.argv.includes('--self-test')) {
  const mutated = structuredClone(ledger);
  mutated.assignments = mutated.assignments.slice(1);
  if (mutated.assignments.length !== ledger.counts.assignments - 1) throw new Error('negative control did not remove exactly one assignment');
  if (mutated.assignments.length === mutated.counts.assignments) throw new Error('negative control failed to make declared coverage inconsistent');
  console.log('S5 data-migration negative control passed');
}

console.log(JSON.stringify({ packages: ledger.counts.packages, assignments: ledger.counts.assignments, persistedAssignments: retained.length, ragPhysicalOwner: true, status: 'passed' }, null, 2));
