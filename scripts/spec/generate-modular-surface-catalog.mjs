import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
const evidenceRoot = process.env.AGON_SPEC_EVIDENCE_DIR ?? resolve(root, 'docs/specs/evidence');
const generatedRoot = process.env.AGON_SPEC_GENERATED_DIR ?? resolve(root, 'packages/mod-kernel/src/generated');
const inventory = JSON.parse(readFileSync(resolve(evidenceRoot, 'modular-agon-current-inventory.json'), 'utf8'));
const ownership = JSON.parse(readFileSync(resolve(evidenceRoot, 'modular-agon-ownership.json'), 'utf8'));
const output = resolve(generatedRoot, 'first-party-surface-catalog.ts');

const projection = new Map([
  ['cliCommands', ['cli', 'cli-command']],
  ['tuiSlashCommands', ['tui', 'tui-action']],
  ['tuiKeyboardActions', ['tui', 'tui-action']],
  ['builtinCommandMetadata', ['tui', 'tui-action']],
  ['intentVariants', ['tui', 'intent']],
  ['mcpTools', ['mcp', 'mcp-tool']],
  ['cesarTools', ['cesar', 'cesar-tool']],
  ['cesarRoutes', ['cesar', 'plan-step']],
  ['generatedDocumentation', ['docs', 'docs']],
]);

const assignmentKey = ({ category, id, source }) => `${category}\0${id}\0${source}`;
const assignmentByOccurrence = new Map(ownership.assignments.map((entry) => [assignmentKey(entry), entry]));
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function packageDirectory(packageName) {
  if (packageName === '@kernlang/agon-kernel') return 'mod-kernel';
  if (packageName === '@kernlang/agon-mod-api') return 'mod-api';
  return packageName.replace('@kernlang/agon-', '');
}

function ownerId(packageName) {
  if (packageName === '@kernlang/agon-kernel') return 'agon.kernel';
  return `agon.${packageName.replace(/^@kernlang\/agon-(?:mod-|support-)?/, '').replace(/[^a-z0-9]+/g, '-')}`;
}

function identity(packageName) {
  const directory = resolve(root, 'packages', packageDirectory(packageName));
  const packageJsonPath = resolve(directory, 'package.json');
  const packageJson = existsSync(packageJsonPath) ? JSON.parse(readFileSync(packageJsonPath, 'utf8')) : { version: '0.0.0' };
  const manifestPath = resolve(directory, 'agon.mod.json');
  const identityBytes = existsSync(manifestPath) ? readFileSync(manifestPath) : Buffer.from(JSON.stringify(packageJson));
  return { id: ownerId(packageName), version: packageJson.version, contentHash: sha256(identityBytes) };
}

const tuiAliases = Object.freeze({ leaderboard: ['elo'], 'cesar-report': ['cesar-stats'], 'cesar-hints': ['cesar-debug'], campfire: ['talk'], synthesis: ['synth'], workspace: ['ws'], models: ['setup'], tokens: ['usage', 'cost'], 'harness-replay': ['replay-harness', 'tool-replay'], auto: ['autonomous'], retry: ['resume'], cancel: ['abort'], img: ['image'], chat: ['ask'], cp: ['copy'], pipeline: ['pipe'], review: ['cr'], run: ['exec', 'shell'], permissions: ['perms'], nogate: ['no-gate'], nero: ['devil', 'adversarial'], explore: ['readonly', 'plan-mode'], clear: ['clean'], exit: ['quit'] });
const builtinAliases = Object.freeze({ review: ['cr'], auto: ['autonomous'], workspace: ['ws'], clear: ['clean'], worktree: ['wt'], help: ['slash-list'] });
const builtinAliasIds = new Set(Object.values(builtinAliases).flat());
const tuiPublicIds = new Set((inventory.categories.tuiSlashCommands ?? []).map((entry) => String(entry.id).slice(1)));
const builtinGroups = new Map((inventory.categories.builtinCommandMetadata ?? []).map((entry) => [entry.id, entry.category ?? 'generated']));
const cliPublicIds = new Set((inventory.categories.cliCommands ?? []).map((entry) => entry.id));
const entries = [];
for (const [category, [surface, kind]] of projection) {
  for (const [index, occurrence] of (inventory.categories[category] ?? []).entries()) {
    const assignment = assignmentByOccurrence.get(assignmentKey({ category, id: occurrence.id, source: occurrence.source }));
    if (!assignment) throw new Error(`surface occurrence has no owner: ${category}/${occurrence.id}@${occurrence.source}`);
    const description = String(occurrence.description ?? occurrence.title ?? occurrence.id);
    entries.push({
      surface,
      kind,
      registryId: `${category}:${String(index).padStart(4, '0')}`,
      publicId: occurrence.id,
      category,
      group: String(occurrence.category ?? builtinGroups.get(String(occurrence.id).replace(/^\//, '')) ?? assignment.class),
      source: occurrence.source,
      ...(occurrence.aliasOf && (category !== 'cliCommands' || cliPublicIds.has(occurrence.aliasOf)) ? { aliasOf: occurrence.aliasOf } : {}),
      aliases: category === 'builtinCommandMetadata' ? (builtinAliases[occurrence.id] ?? []) : category === 'tuiSlashCommands' ? (tuiAliases[String(occurrence.id).slice(1)] ?? []).filter((alias) => !tuiPublicIds.has(alias) && !builtinAliasIds.has(alias)) : [],
      owner: identity(assignment.package),
      ownerClass: assignment.class,
      description,
      accessibility: {
        label: description,
        fallbackText: description,
        keyboardAccessible: true,
        colorIndependent: true,
      },
    });
  }
}

entries.sort((left, right) => left.surface.localeCompare(right.surface) || left.kind.localeCompare(right.kind) || left.registryId.localeCompare(right.registryId));
const text = `/** Generated by scripts/spec/generate-modular-surface-catalog.mjs. Do not edit. */\nimport type { GeneratedSurfaceCatalogEntry } from '../surface-generation.js';\n\nexport const FIRST_PARTY_SURFACE_CATALOG = Object.freeze(${JSON.stringify(entries, null, 2)}) as readonly GeneratedSurfaceCatalogEntry[];\n`;

if (check) {
  if (!existsSync(output) || readFileSync(output, 'utf8') !== text) throw new Error('generated first-party surface catalog drift');
} else {
  writeFileSync(output, text);
}

console.log(JSON.stringify({ entries: entries.length, owners: new Set(entries.map(({ owner }) => owner.id)).size, surfaces: Object.fromEntries([...new Set(entries.map(({ surface }) => surface))].map((surface) => [surface, entries.filter((entry) => entry.surface === surface).length])) }, null, 2));
