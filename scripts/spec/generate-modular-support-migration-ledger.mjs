import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const evidence = join(root, 'docs/specs/evidence');
const roadmap = JSON.parse(readFileSync(join(evidence, 'modular-agon-implementation-roadmap.json'), 'utf8'));
const supportPackages = roadmap.packages.filter((entry) => entry.class === 'hidden-shared-support-package');
const destinations = {
  '@kernlang/agon-support-engine-runtime': ['src/types.ts', 'src/engine-discover.ts', 'src/engine-health.ts', 'src/engine-memory.ts', 'src/auth-store.ts', 'src/isolation.ts', 'src/process.ts', 'src/semaphore.ts', 'engines/', 'python/', 'patches/'],
  '@kernlang/agon-support-engine-catalog': ['src/engine-registry.ts', 'src/cli-models-registry.ts'],
  '@kernlang/agon-support-persistence': ['src/paths.ts', 'src/file-history.ts', 'src/event-log.ts', 'src/session-store.ts', 'src/session-pty.ts', 'src/brain-client.ts', 'src/session-result-types.ts', 'src/flow.ts', 'src/run-dir.ts', 'src/team-elo-types.ts', 'python/history-search.py'],
  '@kernlang/agon-support-verification': ['src/guard-types.ts', 'src/guard-telemetry.ts', 'src/guard-telemetry-store.ts', 'src/checker-discovery.ts', 'src/information-gain.ts', 'src/pipeline-types.ts', 'python/'],
  '@kernlang/agon-support-worktree': ['src/plan.ts', 'src/worktree-lock.ts', 'src/worktree-session.ts'],
  '@kernlang/agon-support-panel': ['src/health-check.ts', 'src/seat-dispatch.ts'],
  '@kernlang/agon-support-judge': ['src/contracts.ts', 'src/judge.ts'],
  '@kernlang/agon-support-agent-runtime': ['src/agent-loop.ts', 'src/agent-session.ts'],
  '@kernlang/agon-support-dedup': ['src/dedup-resolver.ts', 'python/'],
  '@kernlang/agon-support-browser-bridge': ['src/syntax-validator-bridge.ts', 'src/browser-host.ts'],
  '@kernlang/agon-support-saas-api': ['python/'],
};

function sourceFile(locator) {
  return locator.replace(/:\d+$/, '');
}

const entries = [];
for (const pkg of supportPackages) {
  const packageDir = `packages/support-${pkg.id.slice('@kernlang/agon-support-'.length)}`;
  for (const destination of destinations[pkg.id] ?? []) {
    if (!existsSync(join(root, packageDir, destination))) {
      throw new Error(pkg.id + ": declared destination does not exist: " + destination);
    }
  }
  for (const source of pkg.extractionSources) {
    const file = sourceFile(source);
    const absolute = join(root, file);
    if (!existsSync(absolute)) throw new Error(`${pkg.id}: extraction source disappeared without a ledger disposition: ${source}`);
    const text = /\.(?:ts|tsx|js|mjs|cjs)$/.test(file) ? readFileSync(absolute, 'utf8') : '';
    let disposition = 'compatibility-consumer';
    if (file.startsWith(packageDir + '/')) disposition = 'physical-owner';
    else if (text.includes(pkg.id)) disposition = 'compatibility-adapter';
    else if (/\.(?:py|json|patch)$|requirements\.txt$/.test(file)) disposition = 'byte-verified-compatibility-mirror';
    entries.push({
      owner: pkg.id,
      source,
      disposition,
      destination: destinations[pkg.id],
      removalCondition: disposition === 'physical-owner'
        ? null
        : 'remove legacy path only after its consuming mod/surface or installer is cut over and its kill-list gate passes',
      evidence: disposition === 'byte-verified-compatibility-mirror'
        ? ['S4-ASSET-PARITY', 'S4-PACK']
        : ['S4-BOUNDARY', 'S4-PARITY'],
    });
  }
}

const counts = Object.fromEntries([...new Set(entries.map((entry) => entry.disposition))]
  .sort().map((disposition) => [disposition, entries.filter((entry) => entry.disposition === disposition).length]));
const ledger = {
  schemaVersion: 1,
  slice: 'S4',
  semantics: 'Roadmap extractionSources are ownership occurrences. Whole modules move when they are support implementation; UI/mod consumers remain narrow compatibility consumers until S5/S6.',
  packages: supportPackages.length,
  sourceOccurrences: entries.length,
  counts,
  entries,
};
const outputPath = join(evidence, "modular-agon-slice4-migration-ledger.json");
const serialized = JSON.stringify(ledger, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== serialized) {
    throw new Error("S4 migration ledger drift: regenerate it before qualification");
  }
} else {
  writeFileSync(outputPath, serialized);
}
console.log(JSON.stringify({ packages: ledger.packages, sourceOccurrences: ledger.sourceOccurrences, counts }, null, 2));
