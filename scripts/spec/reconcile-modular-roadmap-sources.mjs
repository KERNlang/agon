import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const evidence = join(root, 'docs/specs/evidence');
const roadmapPath = join(evidence, 'modular-agon-implementation-roadmap.json');
const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8'));
const ownership = JSON.parse(readFileSync(join(evidence, 'modular-agon-ownership.json'), 'utf8'));
const packageMap = JSON.parse(readFileSync(join(evidence, 'modular-agon-package-map.json'), 'utf8'));
const packageMapById = new Map(packageMap.packages.map((pkg) => [pkg.id, pkg]));
const byPackage = new Map();
for (const assignment of ownership.assignments) {
  const sources = byPackage.get(assignment.package) ?? new Set();
  sources.add(assignment.source);
  byPackage.set(assignment.package, sources);
}
for (const pkg of roadmap.packages) {
  const authoritative = packageMapById.get(pkg.id);
  if (!authoritative) throw new Error(`roadmap package is absent from authoritative package map: ${pkg.id}`);
  pkg.dependencies = [...authoritative.dependencies];
  pkg.extractionSources = [...new Set([
    ...pkg.extractionSources,
    ...(byPackage.get(pkg.id) ?? []),
  ])].sort();
}
writeFileSync(roadmapPath, `${JSON.stringify(roadmap, null, 2)}\n`);
console.log(JSON.stringify({ packages: roadmap.packages.length, dependencyEdges: roadmap.packages.reduce((sum, pkg) => sum + pkg.dependencies.length, 0), assignedSources: ownership.assignments.length }, null, 2));
