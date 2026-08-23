import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const json = (path) => JSON.parse(readFileSync(`${root}/${path}`, 'utf8'));
const roadmap = json('docs/specs/evidence/modular-agon-implementation-roadmap.json');
const packageMap = json('docs/specs/evidence/modular-agon-package-map.json');
const ownership = json('docs/specs/evidence/modular-agon-ownership.json');
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const ids = new Set(packageMap.packages.map(({ id }) => id));
const byId = new Map(roadmap.packages.map((pkg) => [pkg.id, pkg]));
check(roadmap.packages.length === 49 && byId.size === 49, 'roadmap must contain 49 unique packages');
for (const id of ids) check(byId.has(id), `roadmap misses ${id}`);
const globalEdges = new Set();
for (const pkg of roadmap.packages) {
  check(ids.has(pkg.id), `roadmap has unknown ${pkg.id}`);
  for (const field of ['owner', 'publicBoundary', 'privateBoundary', 'migrationSlice', 'compatibilityAdapter']) check(Boolean(pkg[field]), `${pkg.id} misses ${field}`);
  for (const field of ['extractionSources', 'killList', 'acceptanceEvidence']) check(Array.isArray(pkg[field]) && pkg[field].length > 0, `${pkg.id} misses ${field}`);
  check(Array.isArray(pkg.dependencies), `${pkg.id} misses dependencies`);
  check(new Set(pkg.dependencies).size === pkg.dependencies.length, `${pkg.id} has duplicate dependencies`);
  for (const dependency of pkg.dependencies) {
    const edge = `${pkg.id}->${dependency}`;
    check(!globalEdges.has(edge), `duplicate global edge ${edge}`); globalEdges.add(edge);
    check((byId.get(dependency)?.migrationOrder ?? Infinity) < pkg.migrationOrder, `${pkg.id} migrates before dependency ${dependency}`);
  }
  for (const source of pkg.extractionSources) {
    const path = source.replace(/:[0-9]+$/, '');
    check(existsSync(`${root}/${path}`), `${pkg.id} source does not exist: ${source}`);
  }
}
for (const assignment of ownership.assignments) check(byId.get(assignment.package)?.extractionSources.includes(assignment.source), `${assignment.package} misses source ${assignment.source}`);
for (const slice of roadmap.slices) for (const field of ['entryCriteria', 'exitCriteria', 'acceptanceCommands', 'rollback', 'evidence']) check(Array.isArray(slice[field]) && slice[field].length > 0, `${slice.id} misses ${field}`);
check(roadmap.claims.every(({ state, evidence }) => ['implemented', 'partially-implemented', 'specified-only', 'externally-blocked', 'future-product-decision'].includes(state) && evidence.length > 0), 'claim reconciliation is incomplete');
if (errors.length) { console.error(errors.map((error) => `- ${error}`).join('\n')); process.exit(1); }
console.log(JSON.stringify({ packages: roadmap.packages.length, uniqueEdges: globalEdges.size, legacyAssignments: ownership.assignments.length, slices: roadmap.slices.length, claims: roadmap.claims.length, status: 'passed' }, null, 2));
