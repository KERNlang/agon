import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  ExternalActivationStore,
  TrustGrantStore,
  bootstrapFirstPartySurfaceGeneration,
  discoverUserFolderMods,
  evaluateThirdPartyAuthority,
  sha256Canonical,
} from '../../packages/mod-kernel/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const sandbox = mkdtempSync(join(tmpdir(), 'agon-s8-performance-'));
const hostRoot = join(sandbox, 'modular-host');
const modsRoot = join(sandbox, 'mods');
const COUNT = 10;
const DISCOVERY_SAMPLE_COUNT = 40;

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function createFixture(index) {
  const id = `performance.mod-${index}`;
  const command = `perf-mod-${index}`;
  const packageRoot = join(modsRoot, id);
  mkdirSync(join(packageRoot, 'dist'), { recursive: true });
  const manifest = {
    schemaVersion: 2, id, name: `Performance mod ${index}`, version: '1.0.0', apiRange: '>=1 <2',
    execution: 'executable', compatibility: { kernelRange: '>=0.0.0-0 <2', nodeRange: '>=22' },
    packageClass: 'user-toggleable-mod-package', entrypoints: { runtime: 'dist/index.js', types: 'dist/index.d.ts' },
    display: { group: 'Performance fixtures', order: index }, dependencies: { required: [], optional: [], conflicts: [] },
    permissions: [], platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'], assets: [],
    contributes: { cliCommands: [{ id: command, aliases: [] }], tuiActions: [], mcpTools: [], cesarTools: [],
      lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [] },
    pack: { include: ['agon.mod.json', 'package.json', 'dist/index.js', 'dist/index.d.ts'], executable: [] },
  };
  writeFileSync(join(packageRoot, 'agon.mod.json'), JSON.stringify(manifest));
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(packageRoot, 'dist/index.d.ts'), 'export {};\n');
  writeFileSync(join(packageRoot, 'dist/index.js'), `export default()=>({apiVersion:'1',async activate(r){r.command('cli',{id:${JSON.stringify(command)},aliases:[],description:'perf',inputSchema:{type:'object'},async run(){return {exitCode:0}}})}});\n`);
}

const runtime = { command: () => ({ exitCode: 0 }), tool: () => ({}), parseIntent: () => undefined, renderDocs: (id) => ({ text: id }) };

try {
  for (let index = 0; index < COUNT; index += 1) createFixture(index);
  const discoverySamples = [];
  let candidates = [];
  for (let pass = 0; pass < DISCOVERY_SAMPLE_COUNT; pass += 1) {
    const started = performance.now();
    candidates = await discoverUserFolderMods(modsRoot);
    discoverySamples.push(performance.now() - started);
  }
  const store = new TrustGrantStore(hostRoot);
  const activation = new ExternalActivationStore(hostRoot);
  for (const candidate of candidates) {
    const plan = store.previewTrust({
      modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source,
      sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
      decision: 'trusted', decidedAt: '2026-09-03T00:00:00.000Z', scope: 'exact-artifact',
      publisher: { registryOrigin: 'local-user-folder', packageName: candidate.manifest.id,
        provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' }, reason: 'performance fixture',
    });
    await store.apply(plan, { approvedPlanHash: plan.planHash });
    const activationPlan = activation.preview({ modId: candidate.manifest.id, version: candidate.manifest.version,
      source: candidate.source, sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
      publisherHash: sha256Canonical({ registryOrigin: 'local-user-folder', packageName: candidate.manifest.id, provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' }) },
    true, 'performance fixture', '2026-09-03T00:00:01.000Z');
    await activation.apply(activationPlan, activationPlan.planHash);
  }
  const [trustRecords, grantRecords] = await Promise.all([store.readTrust(), store.readGrants()]);
  const authoritySamples = [];
  for (let pass = 0; pass < 100; pass += 1) {
    const started = performance.now();
    for (const candidate of candidates) evaluateThirdPartyAuthority({
      modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source,
      sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
      publisher: { registryOrigin: 'local-user-folder', packageName: candidate.manifest.id,
        provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' },
    }, candidate.manifest, trustRecords, grantRecords);
    authoritySamples.push(performance.now() - started);
  }
  const startupSamples = [];
  let maxRssBytes = 0;
  for (let pass = 0; pass < 5; pass += 1) {
    const started = performance.now();
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot, modsRoot, runtime });
    startupSamples.push(performance.now() - started);
    maxRssBytes = Math.max(maxRssBytes, process.memoryUsage().rss);
    if (boot.activated.generation.catalog('cli').filter(({ category }) => category.startsWith('external:')).length !== COUNT) {
      throw new Error('performance bootstrap did not project every trusted folder mod');
    }
    await boot.activated.dispose();
  }
  const metrics = {
    schemaVersion: 1,
    measurement: 'modular-agon-slice8',
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    fixtureMods: COUNT,
    sampleCounts: { discovery: discoverySamples.length, authority: authoritySamples.length, trustedBootstrap: startupSamples.length },
    samples: { discoveryMs: discoverySamples, authorityTenModsMs: authoritySamples, trustedBootstrapMs: startupSamples },
    discoveryP95Ms: percentile(discoverySamples, 0.95),
    authorityTenModsP95Ms: percentile(authoritySamples, 0.95),
    trustedBootstrapP95Ms: percentile(startupSamples, 0.95),
    maxRssBytes,
    budgets: { discoveryP95Ms: 100, authorityTenModsP95Ms: 25, trustedBootstrapP95Ms: 750, maxRssBytes: 268435456 },
  };
  metrics.passed = metrics.discoveryP95Ms <= metrics.budgets.discoveryP95Ms
    && metrics.authorityTenModsP95Ms <= metrics.budgets.authorityTenModsP95Ms
    && metrics.trustedBootstrapP95Ms <= metrics.budgets.trustedBootstrapP95Ms
    && metrics.maxRssBytes <= metrics.budgets.maxRssBytes;
  if (!process.argv.includes('--no-write')) writeFileSync(join(root, 'docs/specs/evidence/modular-agon-slice8-performance.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(JSON.stringify(metrics, null, 2));
  if (!metrics.passed) process.exitCode = 1;
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
