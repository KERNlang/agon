import type { ModManifest } from '@kernlang/agon-mod-api';
import type { FolderModCandidate } from './folder-mods.js';
import type { GeneratedSurfaceCatalogEntry } from './surface-generation.js';

type SurfaceContribution = {
  readonly manifestKind: keyof ModManifest['contributes'];
  readonly surface: GeneratedSurfaceCatalogEntry['surface'];
  readonly kind: GeneratedSurfaceCatalogEntry['kind'];
  readonly prefix?: string;
};

const SURFACES: readonly SurfaceContribution[] = Object.freeze([
  { manifestKind: 'cliCommands', surface: 'cli', kind: 'cli-command' },
  { manifestKind: 'tuiActions', surface: 'tui', kind: 'tui-action', prefix: '/' },
  { manifestKind: 'tuiActions', surface: 'tui', kind: 'intent', prefix: '/' },
  { manifestKind: 'mcpTools', surface: 'mcp', kind: 'mcp-tool' },
  { manifestKind: 'cesarTools', surface: 'cesar', kind: 'cesar-tool' },
  { manifestKind: 'generatedDocs', surface: 'docs', kind: 'docs' },
  { manifestKind: 'lifecycleHooks', surface: 'cesar', kind: 'lifecycle' },
  { manifestKind: 'resultTypes', surface: 'docs', kind: 'result-type' },
  { manifestKind: 'configKeys', surface: 'docs', kind: 'config' },
]);

function entry(
  candidate: FolderModCandidate,
  definition: SurfaceContribution,
  contribution: ModManifest['contributes'][keyof ModManifest['contributes']][number],
): GeneratedSurfaceCatalogEntry {
  const publicId = `${definition.prefix ?? ''}${contribution.id}`;
  const description = `${candidate.manifest.name}: ${contribution.id}`;
  return Object.freeze({
    surface: definition.surface,
    kind: definition.kind,
    registryId: contribution.id,
    publicId,
    category: `external:${definition.manifestKind}`,
    group: candidate.manifest.display.group,
    source: candidate.sourceLocator,
    aliases: Object.freeze(contribution.aliases.map((alias) => `${definition.prefix ?? ''}${alias}`)),
    owner: Object.freeze({
      id: candidate.manifest.id,
      version: candidate.manifest.version,
      contentHash: candidate.contentHash,
    }),
    ownerClass: candidate.manifest.packageClass,
    description,
    accessibility: Object.freeze({
      label: description,
      fallbackText: description,
      keyboardAccessible: true,
      colorIndependent: true,
    }),
  });
}

/** Project a statically inspected external manifest without importing its runtime. */
export function createExternalSurfaceCatalog(
  candidates: readonly FolderModCandidate[],
): readonly GeneratedSurfaceCatalogEntry[] {
  const entries = candidates.flatMap((candidate) => SURFACES.flatMap((definition) =>
    candidate.manifest.contributes[definition.manifestKind].map((contribution) =>
      entry(candidate, definition, contribution))));
  return Object.freeze(entries.sort((left, right) =>
    left.surface.localeCompare(right.surface)
      || left.kind.localeCompare(right.kind)
      || left.registryId.localeCompare(right.registryId)));
}
