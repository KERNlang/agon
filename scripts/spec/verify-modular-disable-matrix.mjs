import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const { ModRegistry, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } = await import(pathToFileURL(resolve(root, 'packages/mod-kernel/dist/index.js')).href);
const catalog = createFirstPartyModCatalog();
const full = createFullCompatDesiredState(catalog, '2026-08-23T20:00:00.000Z');
const hash = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const loaded = new Map();
for (const mod of catalog.mods) {
  const directory = resolve(root, `packages/mod-${mod.id.replace('@kernlang/agon-mod-', '')}`);
  loaded.set(mod.modId, { manifest: JSON.parse(readFileSync(resolve(directory, 'agon.mod.json'))), module: await import(pathToFileURL(resolve(directory, 'dist/index.js')).href) });
}
const runtime = Object.freeze({ command: () => ({ exitCode: 0 }), tool: async () => null, parseIntent: async () => undefined, lifecycle: async () => undefined, render: async () => ({ text: 'compatibility' }) });
const registryKind = (kind) => ({ 'cli-command': 'cli-command', 'tui-action': 'tui-action', intent: 'intent', 'mcp-tool': 'mcp-tool', 'cesar-tool': 'cesar-tool', 'result-type': 'result-type', config: 'config', docs: 'docs' })[kind];

function assertInactiveUnreachable(registry, inactive) {
  for (const id of inactive) for (const entry of loaded.get(id).module.COMPATIBILITY_CONTRIBUTIONS) {
    if (registry.resolve(registryKind(entry.registryKind), entry.id)) throw new Error(id + ': inactive contribution remained reachable: ' + entry.id);
  }
  for (const projection of Object.values(registry.projections())) for (const entry of projection.entries) {
    if (inactive.has(entry.owner.id)) throw new Error(entry.owner.id + ': inactive owner projected');
  }
}

for (const disabled of catalog.mods) {
  const plan = planDesiredStateChange(catalog, full, { kind: 'disable', id: disabled.modId }, '2026-08-23T20:00:00.000Z');
  const inactive = new Set([disabled.modId, ...plan.cascaded]);
  const active = [...loaded.entries()].filter(([id]) => plan.effective.includes(id));
  const registry = new ModRegistry({ generation: `s5-without-${disabled.modId}`, activeOwners: active.map(([, { manifest }]) => ({ id: manifest.id, version: manifest.version, contentHash: hash(JSON.stringify(manifest)) })) });
  for (const [, record] of active) {
    const session = registry.beginRegistration(record.manifest);
    await record.module.createFirstPartyCompatibilityMod(runtime).activate(session.registrar);
    session.commit();
  }
  assertInactiveUnreachable(registry, inactive);
}

if (process.argv.includes('--self-test')) {
  const first = catalog.mods[0];
  const allActive = [...loaded.values()];
  const registry = new ModRegistry({ generation: 's5-negative-control', activeOwners: allActive.map(({ manifest }) => ({ id: manifest.id, version: manifest.version, contentHash: hash(JSON.stringify(manifest)) })) });
  for (const record of allActive) {
    const session = registry.beginRegistration(record.manifest);
    await record.module.createFirstPartyCompatibilityMod(runtime).activate(session.registrar);
    session.commit();
  }
  let rejected = false;
  try { assertInactiveUnreachable(registry, new Set([first.modId])); } catch { rejected = true; }
  if (!rejected) throw new Error('negative control failed to detect a reachable disabled mod');
  console.log('S5 disable-matrix negative control passed');
}
console.log(JSON.stringify({ mods: catalog.mods.length, cases: catalog.mods.length, status: 'passed' }, null, 2));
