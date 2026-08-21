/**
 * Minimal, dependency-free semver + range matcher for subflow `version` refs.
 *
 * Supported ranges: `*`, exact (`1.2.3`), `=`, `^`, `~`, `>`, `>=`, `<`, `<=`,
 * partial versions (`1.2` → `1.2.x`), space-separated conjunctions and
 * `||` alternatives. That is the whole surface the flow schema needs; anything
 * else — an empty or stray `||` alternative, a fixed part behind a wildcard
 * (`1.x.2`), an operator with no concrete operand (`>=*`) — is reported as an
 * invalid range rather than silently matching.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(input: string): SemVer | null {
  const match = SEMVER_RE.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function isSemver(input: string): boolean {
  return parseSemver(input) !== null;
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // a is a release, b a prerelease → a is greater
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNum = /^\d+$/.test(left);
    const rightNum = /^\d+$/.test(right);
    if (leftNum && rightNum) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (leftNum !== rightNum) {
      return leftNum ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

interface Bound {
  op: '>=' | '>' | '<=' | '<' | '=';
  version: SemVer;
}

/** Parses `1`, `1.2`, `1.2.3` (with optional prerelease) into fixed parts. */
function parsePartial(input: string): { parts: number[]; prerelease: string[] } | null {
  const cleaned = input.trim();
  if (cleaned === '' || cleaned === '*' || cleaned === 'x' || cleaned === 'X') {
    return { parts: [], prerelease: [] };
  }
  const [core, pre] = cleaned.split('-', 2);
  const segments = core.split('.');
  if (segments.length > 3) return null;
  const parts: number[] = [];
  let wildcard = false;
  for (const segment of segments) {
    const isWildcard = segment === 'x' || segment === 'X' || segment === '*';
    if (wildcard) {
      // `1.x.2` / `x.2`: a fixed part BEHIND a wildcard pins nothing. Rather
      // than silently reading it as `1.x`, call the range malformed.
      if (!isWildcard) return null;
      continue;
    }
    if (isWildcard) {
      wildcard = true;
      continue;
    }
    if (!/^\d+$/.test(segment)) return null;
    parts.push(Number(segment));
  }
  return { parts, prerelease: pre ? pre.split('.') : [] };
}

function toSemver(parts: number[], prerelease: string[]): SemVer {
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
    prerelease,
  };
}

function upperBoundFor(parts: number[]): SemVer | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return toSemver([parts[0] + 1, 0, 0], []);
  if (parts.length === 2) return toSemver([parts[0], parts[1] + 1, 0], []);
  return null;
}

function caretUpper(parts: number[]): SemVer {
  const [major = 0, minor = 0, patch = 0] = parts;
  if (major !== 0) return toSemver([major + 1, 0, 0], []);
  if (parts.length === 1) return toSemver([1, 0, 0], []);
  if (minor !== 0 || parts.length === 2) return toSemver([0, minor + 1, 0], []);
  return toSemver([0, 0, patch + 1], []);
}

function tildeUpper(parts: number[]): SemVer {
  const [major = 0, minor = 0] = parts;
  if (parts.length <= 1) return toSemver([major + 1, 0, 0], []);
  return toSemver([major, minor + 1, 0], []);
}

/** Expands one comparator token into concrete bounds, or null if malformed. */
function parseComparator(token: string): Bound[] | null {
  const raw = token.trim();
  if (raw === '' || raw === '*' || raw === 'x' || raw === 'X') return [];

  const match = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(raw);
  if (!match) return null;
  const op = match[1] ?? '';
  const parsed = parsePartial(match[2]);
  if (!parsed) return null;
  const { parts, prerelease } = parsed;
  if (parts.length === 0) {
    // A bare wildcard (`*`, `x.x`) matches everything; an OPERATOR with
    // nothing concrete to bound (`>=*`, `<x`, `^x`) is malformed.
    return op === '' ? [] : null;
  }
  const lower = toSemver(parts, prerelease);

  switch (op) {
    case '^':
      return [{ op: '>=', version: lower }, { op: '<', version: caretUpper(parts) }];
    case '~':
      return [{ op: '>=', version: lower }, { op: '<', version: tildeUpper(parts) }];
    case '>=':
      return [{ op: '>=', version: lower }];
    case '>':
      return [{ op: '>', version: lower }];
    case '<=':
      return [{ op: '<=', version: lower }];
    case '<':
      return [{ op: '<', version: lower }];
    default: {
      // Exact / partial-exact: `1.2` means `>=1.2.0 <1.3.0`.
      const upper = upperBoundFor(parts);
      if (upper) return [{ op: '>=', version: lower }, { op: '<', version: upper }];
      return [{ op: '=', version: lower }];
    }
  }
}

function satisfiesBound(version: SemVer, bound: Bound): boolean {
  const cmp = compareSemver(version, bound.version);
  switch (bound.op) {
    case '>=': return cmp >= 0;
    case '>': return cmp > 0;
    case '<=': return cmp <= 0;
    case '<': return cmp < 0;
    case '=': return cmp === 0;
  }
}

export interface RangeCheck {
  /** False when the range string itself is malformed. */
  valid: boolean;
  satisfied: boolean;
}

export function checkRange(version: string, range: string): RangeCheck {
  const parsedVersion = parseSemver(version);
  if (!parsedVersion) return { valid: true, satisfied: false };

  const alternatives = range.split('||');
  let satisfied = false;
  for (const alternative of alternatives) {
    const tokens = alternative.trim().split(/\s+/).filter((token) => token !== '');
    if (tokens.length === 0) {
      // An EMPTY alternative (`""`, `"||"`, `"^1 ||"`) used to be read as
      // "matches everything", which silently bypassed the constraint the
      // author wrote. A wildcard has to be spelled `*`.
      return { valid: false, satisfied: false };
    }
    let all = true;
    for (const token of tokens) {
      const bounds = parseComparator(token);
      if (bounds === null) return { valid: false, satisfied: false };
      for (const bound of bounds) {
        if (!satisfiesBound(parsedVersion, bound)) all = false;
      }
    }
    if (all) satisfied = true;
  }
  return { valid: true, satisfied };
}

export function satisfies(version: string, range: string): boolean {
  const result = checkRange(version, range);
  return result.valid && result.satisfied;
}
