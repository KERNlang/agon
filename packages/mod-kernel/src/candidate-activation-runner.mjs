import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

// The installer verifies this package before starting this isolated process.
const inputPath = process.argv[2];
assert.equal(typeof inputPath, 'string', 'candidate input is required');
assert.ok((await stat(inputPath)).size <= 8 * 1024 * 1024, 'candidate input exceeds byte limit');
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const kernel = await import(new URL('./index.js', import.meta.url).href);
const { planHash, ...unsigned } = input.plan;
assert.equal(kernel.sha256Canonical(unsigned), planHash, 'candidate plan hash mismatch');
const configurationFiles = Object.fromEntries(Object.entries(input.configurationFiles)
  .map(([path, value]) => [path, Buffer.from(value, 'base64')]));
const unexpectedExecution = () => { throw new Error('candidate qualification cannot execute a workflow'); };
const boot = await kernel.bootstrapFirstPartySurfaceGeneration({
  hostRoot: input.hostRoot,
  candidateSelection: { desiredState: input.plan.desiredState, lock: input.plan.lock,
    configSource: input.plan.configSource, configurationFiles },
  runtime: { command: unexpectedExecution, tool: unexpectedExecution,
    parseIntent: unexpectedExecution, renderDocs: unexpectedExecution },
});
const surfaceCounts = {};
try {
  assert.equal(boot.activated.generation.id, `candidate:${input.plan.lock.graphHash}`, 'candidate selection was not applied');
  const catalog = kernel.createFirstPartyModCatalog();
  const selected = new Set(input.plan.packages.map(entry => entry.id));
  const expectedPackages = catalog.mods.map(entry => entry.id).filter(id => selected.has(id)).sort();
  assert.deepEqual(boot.activePackageIds, expectedPackages, 'candidate activated the wrong packages');
  assert.deepEqual(boot.activated.failedOwnerIds, [], 'candidate activation failed');
  assert.deepEqual(boot.externalDiagnostics, [], 'candidate discovered external mods');
  const disabled = new Set(boot.disabledOwnerIds);
  const expectedCatalog = [...kernel.FIRST_PARTY_SURFACE_CATALOG, ...kernel.KERNEL_MANAGEMENT_SURFACE_CATALOG]
    .filter(entry => !disabled.has(entry.owner.id));
  const key = (kind, id, owner) => JSON.stringify([kind, id, owner]);
  for (const surface of ['cli', 'tui', 'mcp', 'cesar', 'docs']) {
    const actual = boot.activated.generation.project(surface).entries;
    const expected = expectedCatalog.filter(entry => entry.surface === surface);
    assert.deepEqual(actual.map(entry => key(entry.kind, entry.id, entry.owner.id)).sort(),
      expected.map(entry => key(entry.kind, entry.registryId, entry.owner.id)).sort(),
      `candidate registry mismatch: ${surface}`);
    surfaceCounts[surface] = actual.length;
  }
} finally {
  await boot.activated.dispose();
}
// Exit zero without this record cannot qualify the installation.
process.stdout.write(`AGON_CANDIDATE_RESULT:${JSON.stringify({ schemaVersion: 1, planHash,
  activePackageIds: boot.activePackageIds, surfaceCounts, disposed: true })}\n`);
