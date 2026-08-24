import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const evidence = join(root, 'docs/specs/evidence');
const roadmapPath = join(evidence, 'modular-agon-implementation-roadmap.json');
const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8'));
const ownership = JSON.parse(readFileSync(join(evidence, 'modular-agon-ownership.json'), 'utf8'));
const byPackage = new Map();
for (const assignment of ownership.assignments) {
  const sources = byPackage.get(assignment.package) ?? new Set();
  sources.add(assignment.source);
  byPackage.set(assignment.package, sources);
}
for (const pkg of roadmap.packages) {
  pkg.extractionSources = [...new Set([
    ...pkg.extractionSources,
    ...(byPackage.get(pkg.id) ?? []),
  ])].sort();
}
writeFileSync(roadmapPath, `${JSON.stringify(roadmap, null, 2)}\n`);
console.log(JSON.stringify({ packages: roadmap.packages.length, assignedSources: ownership.assignments.length }, null, 2));
