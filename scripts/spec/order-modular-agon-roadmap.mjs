import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../../docs/specs/evidence/modular-agon-implementation-roadmap.json', import.meta.url);
const roadmap = JSON.parse(readFileSync(path, 'utf8'));
const byId = new Map(roadmap.packages.map((pkg) => [pkg.id, pkg]));
const ordered = [];
const remaining = new Set(byId.keys());
while (remaining.size > 0) {
  const ready = [...remaining].filter((id) => byId.get(id).dependencies.every((dependency) => !remaining.has(dependency))).sort();
  if (ready.length === 0) throw new Error(`package graph cycle among ${[...remaining].join(', ')}`);
  for (const id of ready) { ordered.push(id); remaining.delete(id); }
}
for (const pkg of roadmap.packages) pkg.migrationOrder = ordered.indexOf(pkg.id) + 1;
roadmap.packages.sort((left, right) => left.migrationOrder - right.migrationOrder);
writeFileSync(path, `${JSON.stringify(roadmap, null, 2)}\n`);
console.log(JSON.stringify({ packages: ordered.length, first: ordered[0], last: ordered.at(-1) }, null, 2));
