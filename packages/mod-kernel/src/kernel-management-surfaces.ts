import type { GeneratedSurfaceCatalogEntry } from './surface-generation.js';
import { FIRST_PARTY_SURFACE_CATALOG } from './generated/first-party-surface-catalog.js';

const OWNER = (() => {
  const owner = FIRST_PARTY_SURFACE_CATALOG.find((entry) => entry.owner.id === 'agon.kernel')?.owner;
  if (!owner) throw new Error('generated first-party catalog has no kernel owner identity');
  return owner;
})();

function managementEntry(
  surface: 'cli' | 'tui',
  kind: 'cli-command' | 'tui-action',
  publicId: string,
): GeneratedSurfaceCatalogEntry {
  const description = 'Inspect, trust, enable, disable, and diagnose modular Agon packages';
  return Object.freeze({
    surface,
    kind,
    registryId: `kernel:mod-management:${surface}`,
    publicId,
    category: 'kernelModManagement',
    group: 'Kernel',
    source: 'packages/cli/src/commands/mod.ts',
    aliases: Object.freeze([]),
    owner: OWNER,
    ownerClass: 'minimal-kernel-machinery',
    description,
    accessibility: Object.freeze({
      label: description,
      fallbackText: description,
      keyboardAccessible: true,
      colorIndependent: true,
    }),
  });
}

export const KERNEL_MANAGEMENT_SURFACE_CATALOG = Object.freeze([
  managementEntry('cli', 'cli-command', 'mod'),
  managementEntry('tui', 'tui-action', '/mod'),
]);
