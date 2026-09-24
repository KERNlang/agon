import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { schemas } from '../../docs/specs/fixtures/modular-agon-contracts/contracts.mjs';

const root = resolve(import.meta.dirname, '../..');
const specDir = join(root, 'docs/specs');
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

const inventory = json('docs/specs/evidence/modular-agon-current-inventory.json');
const ownership = json('docs/specs/evidence/modular-agon-ownership.json');
const packageMap = json('docs/specs/evidence/modular-agon-package-map.json');
const ui = json('docs/specs/evidence/modular-agon-ui-hierarchy.json');
const killList = json('docs/specs/evidence/modular-agon-migration-kill-list.json');
const ledger = json('docs/specs/evidence/modular-agon-lifecycle-artifact-ledger.json');
const fixtures = json('docs/specs/fixtures/modular-agon-valid-artifacts.json');

const inventoryKeys = new Set(Object.entries(inventory.categories).flatMap(([category, items]) => items.map((item) => `${category}|${item.id}|${item.source}`)));
const ownershipKeys = ownership.assignments.map((item) => `${item.category}|${item.id}|${item.source}`);
check(ownershipKeys.length === inventoryKeys.size, `ownership count ${ownershipKeys.length} differs from inventory ${inventoryKeys.size}`);
check(new Set(ownershipKeys).size === ownershipKeys.length, 'ownership has duplicate cells');
for (const key of inventoryKeys) check(ownershipKeys.includes(key), `missing ownership: ${key}`);

const packageIds = new Set(packageMap.packages.map((pkg) => pkg.id));
check(packageIds.size === packageMap.packages.length, 'duplicate package id');
for (const assignment of ownership.assignments) check(packageIds.has(assignment.package), `unknown owner package: ${assignment.package}`);
for (const pkg of packageMap.packages) for (const dependency of pkg.dependencies) check(packageIds.has(dependency), `${pkg.id} depends on unknown ${dependency}`);
const visiting = new Set(); const visited = new Set();
function visit(id) {
  if (visiting.has(id)) { errors.push(`package dependency cycle at ${id}`); return; }
  if (visited.has(id)) return;
  visiting.add(id);
  const pkg = packageMap.packages.find((entry) => entry.id === id);
  for (const dependency of pkg?.dependencies ?? []) visit(dependency);
  visiting.delete(id); visited.add(id);
}
for (const id of packageIds) visit(id);
const modIds = new Set(packageMap.packages.filter((pkg) => pkg.class === 'user-toggleable-mod-package').map((pkg) => pkg.id.replace('@kernlang/agon-mod-', '')));
for (const group of ui.groups) for (const child of group.children) {
  if (group.nonToggleable) continue;
  const id = typeof child === 'string' ? child : child.id;
  check(modIds.has(id), `UI child has no physical mod: ${id}`);
  if (typeof child === 'object') {
    check(modIds.has(child.parent), `UI parent has no physical mod: ${child.parent}`);
    const packageEntry = packageMap.packages.find((entry) => entry.id === `@kernlang/agon-mod-${child.id}`);
    check(packageEntry?.dependencies.includes(`@kernlang/agon-mod-${child.parent}`), `UI child ${child.id} does not depend on parent ${child.parent}`);
  }
}
check(new Set(ui.groups.flatMap((group) => group.nonToggleable ? [] : group.children.map((child) => typeof child === 'string' ? child : child.id))).size === modIds.size, 'UI hierarchy must contain every user-toggleable mod exactly once');
for (const id of modIds) check(ui.groups.some((group) => !group.nonToggleable && group.children.some((child) => (typeof child === 'string' ? child : child.id) === id)), `UI hierarchy is missing user-toggleable mod: ${id}`);
check(new Set(killList.entries.map((entry) => entry.id)).size === killList.entries.length, 'migration kill-list IDs are not unique');

for (const [name, schema] of Object.entries(schemas)) {
  const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const fixtureKey = key === 'verificationContract' || key === 'verificationReceipt' ? key : key;
  if (fixtureKey in fixtures) schema.parse(fixtures[fixtureKey]);
}
schemas['coverage-ledger'].parse(ledger);
const cells = new Set();
for (const cell of ledger.cells) {
  const key = `${cell.lifecycle}|${cell.artifact}|${cell.platform}`;
  check(!cells.has(key), `duplicate coverage cell: ${key}`); cells.add(key);
  const [link, anchor] = cell.normativeClause.split('#');
  const target = join(root, link);
  check(existsSync(target), `coverage clause file missing: ${cell.normativeClause}`);
  check(packageIds.has(cell.owner), `coverage owner package missing: ${cell.owner}`);
  if (anchor && existsSync(target)) {
    const headings = new Set(readFileSync(target, 'utf8').split('\n').filter((line) => /^#{1,6}\s/.test(line)).map((line) => slug(line.replace(/^#{1,6}\s+/, ''))));
    check(headings.has(anchor), `coverage clause anchor missing: ${cell.normativeClause}`);
  }
}
check(ledger.cells.length === 1480, `coverage cell count is ${ledger.cells.length}, expected 1480`);

function slug(value) {
  return value.trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}
const markdownFiles = readdirSync(specDir).filter((file) => /^modular-agon-.*\.md$/.test(file)).map((file) => join(specDir, file));
for (const file of markdownFiles) {
  const source = readFileSync(file, 'utf8');
  const links = [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
  for (const link of links) {
    if (/^(?:https?:|mailto:)/.test(link) || link.startsWith('#')) continue;
    const [pathPart, anchor] = link.split('#');
    const target = resolve(dirname(file), pathPart);
    check(existsSync(target), `${relative(root, file)} has broken link ${link}`);
    if (anchor && existsSync(target) && extname(target) === '.md') {
      const headings = new Set(readFileSync(target, 'utf8').split('\n').filter((line) => /^#{1,6}\s/.test(line)).map((line) => slug(line.replace(/^#{1,6}\s+/, ''))));
      check(headings.has(anchor), `${relative(root, file)} has missing anchor ${link}`);
    }
  }
  check(!/\bOPEN\b/.test(source), `${relative(root, file)} contains OPEN marker`);
}

const mcpPipeline = ownership.assignments.filter((item) => item.category === 'mcpTools' && item.id === 'Pipeline');
const otherPipeline = ownership.assignments.filter((item) => item.id.toLowerCase() === 'pipeline' && item.category !== 'mcpTools');
check(mcpPipeline.length > 0 && mcpPipeline.every((item) => item.package.endsWith('-pipeline-orchestration')), 'MCP Pipeline split is incomplete');
check(otherPipeline.length > 0 && otherPipeline.every((item) => item.package.endsWith('-pipeline-delivery')), 'delivery Pipeline split is incomplete');

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ inventoryAssignments: ownership.assignments.length, packages: packageMap.packages.length, mods: modIds.size, coverageCells: ledger.cells.length, markdownFiles: markdownFiles.length, status: 'passed' }, null, 2));
