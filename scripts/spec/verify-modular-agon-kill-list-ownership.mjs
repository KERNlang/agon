import { readFileSync } from 'node:fs';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const json = (path) => JSON.parse(readFileSync(`${root}/${path}`, 'utf8'));
const source = json('docs/specs/evidence/modular-agon-migration-kill-list.json');
const roadmap = json('docs/specs/evidence/modular-agon-implementation-roadmap.json');
const expected = new Set(source.entries.map(({ id }) => id));
const assigned = new Set(roadmap.packages.flatMap(({ killList }) => killList));
const missing = [...expected].filter((id) => !assigned.has(id));
const unknown = [...assigned].filter((id) => !expected.has(id));
if (missing.length || unknown.length) {
  console.error(JSON.stringify({ missing, unknown }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ killListEntries: expected.size, assignedEntries: assigned.size, status: 'passed' }, null, 2));
