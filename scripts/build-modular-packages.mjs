import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const graph = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8')).packages;
const selected = graph.filter(({ id }) => !['@kernlang/agon-mod-api', '@kernlang/agon-kernel'].includes(id));
const selectedIds = new Set(selected.map(({ id }) => id));
const pending = new Map(selected.map((entry) => [entry.id, entry]));
const built = new Set();

function directory(id) {
  if (id.startsWith('@kernlang/agon-mod-')) return `packages/mod-${id.slice('@kernlang/agon-mod-'.length)}`;
  if (id.startsWith('@kernlang/agon-support-')) return `packages/support-${id.slice('@kernlang/agon-support-'.length)}`;
  throw new Error(`unknown modular package directory: ${id}`);
}

while (pending.size) {
  const ready = [...pending.values()].filter(({ dependencies }) => dependencies
    .filter((id) => selectedIds.has(id)).every((id) => built.has(id)))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!ready.length) throw new Error(`modular package build cycle: ${[...pending.keys()].join(', ')}`);
  for (const record of ready) {
    const workspace = directory(record.id);
    const result = spawnSync('npm', ['run', 'build', '-w', workspace], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    pending.delete(record.id);
    built.add(record.id);
  }
}

console.log(`built ${built.size} modular support and first-party packages`);
