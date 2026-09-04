import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const home = mkdtempSync(join(tmpdir(), 'agon-s6-perf-home-'));
const packageIds = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'))
  .packages.filter((entry) => entry.class === 'user-toggleable-mod-package').map((entry) => entry.id);
const percentile = (values, pct) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * pct) - 1)];

try {
  const probe = `
    const kernel = await import('@kernlang/agon-kernel');
    const runtime = { command:()=>({exitCode:0}), tool:()=>null, parseIntent:()=>undefined, renderDocs:(id)=>({text:id}) };
    const serviceFor=(manifest)=>({ identity:{id:manifest.id,version:manifest.version,contentHash:manifest.assets[0]?.contentHash??'sha256:${'0'.repeat(64)}'}, source:{kind:'bundled',locator:manifest.id}, logger:{debug(){},info(){},warn(){}}, receipts:{async record(){return 'receipt'}}, permissions:{async check(){return {allowed:true}}}, state:{async read(){},async write(){}}, engines:{async dispatch(){return null}}, firstPartyCompatibility:{command:runtime.command,tool:runtime.tool,parseIntent:runtime.parseIntent,async lifecycle(){},render:runtime.renderDocs} });
    const started=performance.now();
    const packages=await Promise.all(${JSON.stringify(packageIds)}.map(async(id)=>{const loaded=await import(id);const services=serviceFor(loaded.MANIFEST);return {manifest:loaded.MANIFEST,mod:await loaded.createMod(services),services}}));
    const imported=performance.now();
    const activated=await kernel.activateFirstPartySurfaceGeneration({id:'perf:s6',catalog:kernel.FIRST_PARTY_SURFACE_CATALOG,runtime,packages});
    const ready=performance.now();
    for(const surface of ['cli','tui','mcp','cesar','docs']) activated.generation.project(surface);
    await activated.dispose();
    if(global.gc)global.gc();
    console.log(JSON.stringify({importMs:imported-started,activationMs:ready-imported,totalMs:ready-started,rssBytes:process.memoryUsage().rss}));
  `;
  const samples = [];
  for (let index = 0; index < 15; index += 1) {
    const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '--eval', probe], {
      cwd: root, encoding: 'utf8', env: { ...process.env, AGON_HOME: home }, maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(result.stderr || `S6 performance probe failed (${result.status})`);
    samples.push(JSON.parse(result.stdout.trim()));
  }
  const metrics = {
    schemaVersion: 1,
    slice: 'S6',
    sampleCount: samples.length,
    physicalImportMs: { median: percentile(samples.map((sample) => sample.importMs), 0.5), p95: percentile(samples.map((sample) => sample.importMs), 0.95), budgetP95: 750 },
    activationMs: { median: percentile(samples.map((sample) => sample.activationMs), 0.5), p95: percentile(samples.map((sample) => sample.activationMs), 0.95), budgetP95: 250 },
    totalReadyMs: { median: percentile(samples.map((sample) => sample.totalMs), 0.5), p95: percentile(samples.map((sample) => sample.totalMs), 0.95), budgetP95: 1000 },
    residentRssBytes: { median: percentile(samples.map((sample) => sample.rssBytes), 0.5), p95: percentile(samples.map((sample) => sample.rssBytes), 0.95), budgetP95: 192 * 1024 * 1024 },
  };
  metrics.passed = metrics.physicalImportMs.p95 <= metrics.physicalImportMs.budgetP95
    && metrics.activationMs.p95 <= metrics.activationMs.budgetP95
    && metrics.totalReadyMs.p95 <= metrics.totalReadyMs.budgetP95
    && metrics.residentRssBytes.p95 <= metrics.residentRssBytes.budgetP95;
  if (!process.argv.includes('--no-write')) writeFileSync(join(root, 'docs/specs/evidence/modular-agon-slice6-performance.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(JSON.stringify(metrics, null, 2));
  if (!metrics.passed) process.exitCode = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
