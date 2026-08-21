/**
 * Exclusive-route algebra.
 *
 * A route marker records ONE branch decision of an exclusive out-port group
 * (`If/Compare` in v1). A step's route set is the conjunction of the decisions
 * that must hold for it to run; two sets are mutually exclusive when they
 * disagree on the same decision, which is what makes a coalesce legal and a
 * required-input join illegal (spec nero-2 C1).
 */
import type { RouteMarker } from '../models/types.js';

function decisionKey(marker: RouteMarker): string {
  return `${marker.stepId}#${marker.group}`;
}

function markerKey(marker: RouteMarker): string {
  return `${decisionKey(marker)}=${marker.branch}`;
}

export function dedupeRoutes(markers: RouteMarker[]): RouteMarker[] {
  const seen = new Set<string>();
  const out: RouteMarker[] = [];
  for (const marker of markers) {
    const key = markerKey(marker);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(marker);
  }
  return out;
}

export function unionRoutes(sets: RouteMarker[][]): RouteMarker[] {
  return dedupeRoutes(sets.flat());
}

export function intersectRoutes(sets: RouteMarker[][]): RouteMarker[] {
  if (sets.length === 0) return [];
  const [first, ...rest] = sets;
  return dedupeRoutes(
    first.filter((marker) => rest.every(
      (other) => other.some((candidate) => markerKey(candidate) === markerKey(marker)),
    )),
  );
}

export interface RouteConflict {
  stepId: string;
  group: string;
  branches: [string, string];
}

/** The decision two route sets disagree on, if any. */
export function conflictBetween(a: RouteMarker[], b: RouteMarker[]): RouteConflict | null {
  for (const left of a) {
    for (const right of b) {
      if (decisionKey(left) === decisionKey(right) && left.branch !== right.branch) {
        return { stepId: left.stepId, group: left.group, branches: [left.branch, right.branch] };
      }
    }
  }
  return null;
}

function areMutuallyExclusive(a: RouteMarker[], b: RouteMarker[]): boolean {
  return conflictBetween(a, b) !== null;
}

export function allPairsExclusive(sets: RouteMarker[][]): boolean {
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      if (!areMutuallyExclusive(sets[i], sets[j])) return false;
    }
  }
  return true;
}

export function anyPairExclusive(sets: RouteMarker[][]): boolean {
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      if (areMutuallyExclusive(sets[i], sets[j])) return true;
    }
  }
  return false;
}

export function describeConflict(conflict: RouteConflict): string {
  return `${conflict.stepId} (${conflict.group}: "${conflict.branches[0]}" vs "${conflict.branches[1]}")`;
}
