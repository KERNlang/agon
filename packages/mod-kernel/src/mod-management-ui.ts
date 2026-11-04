import { FIRST_PARTY_UI_HIERARCHY } from './generated/first-party-ui-hierarchy.js';
import type { DesiredModState, FirstPartyModCatalog } from './desired-state.js';
import { resolveDesiredState } from './desired-state.js';

export type ModAvailabilityReasonCode =
  | 'not-installed'
  | 'incompatible-agon'
  | 'incompatible-mod-api'
  | 'integrity-mismatch'
  | 'untrusted-source'
  | 'authority-state-invalid'
  | 'permission-not-granted'
  | 'missing-dependency'
  | 'dependency-blocked'
  | 'dependency-cycle'
  | 'conflict'
  | 'duplicate-contribution'
  | 'migration-required'
  | 'active-resource'
  | 'load-failed'
  | 'activation-failed';

export interface ModAvailabilityReason {
  readonly code: ModAvailabilityReasonCode;
  readonly message: string;
  readonly recovery: string;
}

export interface ModManagementEntry {
  readonly kind: 'mod' | 'kernel';
  readonly id: string;
  readonly packageId: string | null;
  readonly label: string;
  readonly parentId: string | null;
  readonly depth: 0 | 1;
  readonly toggleable: boolean;
  readonly focusable: boolean;
  readonly keyboardIndex: number;
  readonly status: 'enabled' | 'disabled' | 'blocked';
  readonly callable: boolean;
  readonly visualStyle: 'normal' | 'greyed' | 'blocked';
  readonly statusText: string;
  readonly ariaLabel: string;
  readonly reason: ModAvailabilityReason | null;
  readonly recovery: string | null;
  readonly source?: 'bundled' | 'registry' | 'user-folder' | 'explicit-dev';
  readonly trustSummary?: string;
  readonly permissionSummary?: string;
}

export interface ModManagementGroup {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly ModManagementEntry[];
}

export interface ModManagementView {
  readonly schemaVersion: 1;
  readonly groups: readonly ModManagementGroup[];
}

export interface ExternalModManagementDefinition {
  readonly id: string;
  readonly packageId: string;
  readonly label: string;
  readonly source: 'registry' | 'user-folder' | 'explicit-dev';
  readonly enabled: boolean;
  readonly trustSummary: string;
  readonly permissionSummary: string;
  readonly reason?: ModAvailabilityReason;
}

export interface ModManagementViewOptions {
  readonly availability?: Readonly<Record<string, ModAvailabilityReason>>;
  readonly externalMods?: readonly ExternalModManagementDefinition[];
}

function title(id: string): string {
  return id.split('-').map((word) => word.length ? word[0]!.toUpperCase() + word.slice(1) : word).join(' ');
}

function humanReason(code: string): string {
  return code.replaceAll('-', ' ');
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function createModManagementView(
  catalog: FirstPartyModCatalog,
  desired: DesiredModState,
  options: ModManagementViewOptions = {},
): ModManagementView {
  const effective = new Set(resolveDesiredState(catalog, desired).effective);
  let keyboardIndex = 0;
  const seenMods = new Set<string>();
  const groups = FIRST_PARTY_UI_HIERARCHY.groups.map((group): ModManagementGroup => {
    const entries = group.children.map((child): ModManagementEntry => {
      const id = typeof child === 'string' ? child : child.id;
      const parentId = typeof child === 'string' ? null : child.parent;
      const modId = `agon.${id}`;
      const definition = catalog.modsById.get(modId);
      const kernel = group.id === 'manage';
      if (!definition && !kernel) throw new TypeError(`UI entry has no first-party mod: ${id}`);
      if (definition) {
        if (seenMods.has(modId)) throw new TypeError(`first-party mod appears more than once in UI: ${modId}`);
        seenMods.add(modId);
      }
      const availability = options.availability?.[modId];
      const enabled = definition ? effective.has(modId) : true;
      const status = availability ? 'blocked' : enabled ? 'enabled' : 'disabled';
      const label = title(id);
      const statusText = availability
        ? `Blocked: ${humanReason(availability.code)}. ${availability.message}`
        : status === 'enabled' ? 'Enabled' : 'Disabled';
      const entry: ModManagementEntry = {
        kind: kernel ? 'kernel' : 'mod',
        id,
        packageId: definition?.id ?? null,
        label,
        parentId,
        depth: parentId ? 1 : 0,
        toggleable: !kernel,
        focusable: true,
        keyboardIndex: keyboardIndex++,
        status,
        callable: status === 'enabled',
        visualStyle: status === 'enabled' ? 'normal' : status === 'disabled' ? 'greyed' : 'blocked',
        statusText,
        ariaLabel: `${label}. ${statusText}${parentId ? `. Depends on ${title(parentId)}` : ''}`,
        reason: availability ?? null,
        recovery: availability?.recovery ?? (status === 'disabled' ? `Enable ${label} to make its surfaces callable.` : null),
      };
      return freeze(entry);
    });
    return freeze({ id: group.id, label: group.label, entries: freeze(entries) });
  });
  if (options.externalMods?.length) {
    const ids = new Set<string>();
    const entries = [...options.externalMods].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)).map((definition): ModManagementEntry => {
      if (ids.has(definition.id) || seenMods.has(definition.id)) throw new TypeError(`duplicate external mod in UI: ${definition.id}`);
      ids.add(definition.id);
      const availability = definition.reason ?? options.availability?.[definition.id];
      const status = availability ? 'blocked' : definition.enabled ? 'enabled' : 'disabled';
      const statusText = availability ? `Blocked: ${humanReason(availability.code)}. ${availability.message}` : status === 'enabled' ? 'Enabled' : 'Disabled';
      return freeze({
        kind: 'mod', id: definition.id, packageId: definition.packageId, label: definition.label,
        parentId: null, depth: 0, toggleable: true, focusable: true, keyboardIndex: keyboardIndex++,
        status, callable: status === 'enabled', visualStyle: status === 'enabled' ? 'normal' : status === 'disabled' ? 'greyed' : 'blocked', statusText,
        ariaLabel: `${definition.label}. ${statusText}. Source ${definition.source}. ${definition.trustSummary}. Permissions ${definition.permissionSummary}.`,
        reason: availability ?? null,
        recovery: availability?.recovery ?? (status === 'disabled' ? `Enable ${definition.label} after reviewing trust and permissions.` : null),
        source: definition.source,
        trustSummary: definition.trustSummary,
        permissionSummary: definition.permissionSummary,
      });
    });
    groups.push(freeze({ id: 'community', label: 'Local and community mods', entries: freeze(entries) }));
  }
  const missing = catalog.mods.map(({ modId }) => modId).filter((id) => !seenMods.has(id));
  if (missing.length) throw new TypeError(`first-party mods missing from UI hierarchy: ${missing.join(', ')}`);
  return freeze({ schemaVersion: 1, groups: freeze(groups) });
}

export function renderModManagementText(view: ModManagementView): string {
  const lines: string[] = [];
  for (const group of view.groups) {
    lines.push(group.label);
    for (const entry of group.entries) {
      const status = entry.status === 'blocked' && entry.reason
        ? `blocked: ${humanReason(entry.reason.code)}`
        : entry.status;
      lines.push(`${entry.depth ? '  ' : ''}- [${status}] ${entry.label}`);
      if (entry.source) {
        const prefix = entry.depth ? '    ' : '  ';
        lines.push(`${prefix}Source: ${entry.source}`);
        lines.push(`${prefix}Trust: ${entry.trustSummary ?? 'not evaluated'}`);
        lines.push(`${prefix}Permissions: ${entry.permissionSummary ?? 'none'}`);
      }
      if (entry.status === 'blocked') {
        lines.push(`${entry.depth ? '    ' : '  '}Reason: ${entry.reason?.message ?? entry.statusText}`);
        lines.push(`${entry.depth ? '    ' : '  '}Recovery: ${entry.recovery ?? 'Inspect Agon Doctor.'}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function focusableIds(view: ModManagementView): readonly string[] {
  return view.groups.flatMap(({ entries }) => entries.filter(({ focusable }) => focusable).map(({ id }) => id));
}

export function reduceModManagementFocus(
  view: ModManagementView,
  currentId: string,
  key: 'ArrowUp' | 'ArrowDown' | 'Home' | 'End',
): string {
  const ids = focusableIds(view);
  if (!ids.length) throw new TypeError('mod management view has no focusable entries');
  const current = Math.max(0, ids.indexOf(currentId));
  if (key === 'Home') return ids[0]!;
  if (key === 'End') return ids.at(-1)!;
  const delta = key === 'ArrowDown' ? 1 : -1;
  return ids[(current + delta + ids.length) % ids.length]!;
}

export function assertModManagementAccessibility(view: ModManagementView): void {
  const entries = view.groups.flatMap(({ entries }) => entries);
  if (!entries.length) throw new TypeError('accessible mod management view must contain entries');
  const indexes = new Set<number>();
  for (const entry of entries) {
    if (!entry.ariaLabel || !entry.ariaLabel.includes(entry.label)) throw new TypeError(`entry ${entry.id} has no usable aria label`);
    if (!entry.statusText.trim()) throw new TypeError(`entry ${entry.id} has no textual status`);
    if (indexes.has(entry.keyboardIndex)) throw new TypeError(`duplicate keyboard index: ${entry.keyboardIndex}`);
    indexes.add(entry.keyboardIndex);
    if (entry.status === 'blocked' && (!entry.reason || !entry.recovery)) throw new TypeError(`blocked entry ${entry.id} lacks reason or recovery`);
    if (entry.status === 'disabled' && entry.visualStyle !== 'greyed') throw new TypeError(`disabled entry ${entry.id} lacks greyed presentation`);
  }
}
