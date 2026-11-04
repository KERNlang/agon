import type { RawFinding } from './consensus.js';

export const MERGE_SIMILARITY = 0.2;

export const MIN_SHARED_TOKENS = 3;

export const LINE_SLACK = 2;

const STOP_WORDS = new Set((
  'the a an and or of to in on for is are be by with this that it its as at from into can when whenever which while so '
  + 'than then but if any all only also has have was were will would should could may might does do did same instead '
  + 'before after because there their them they'
).split(' '));

const SUFFIXES = ['ing', 'ed', 'es', 's', 'ly'];

function stem(word: string): string {
  let w = word;
  const suffix = SUFFIXES.find((s) => w.length > s.length + 3 && w.endsWith(s));
  if (suffix) w = w.slice(0, -suffix.length);
  return w.length > 4 && w.endsWith('e') ? w.slice(0, -1) : w;
}

export function problemTokens(text: string | undefined): Set<string> {
  const words = (text || '').toLowerCase().split(/[^a-z0-9]+/);
  return new Set(words.filter((w) => w.length >= 3 && !STOP_WORDS.has(w)).map(stem));
}

export function lineSpan(lines: string | undefined): [number, number] | undefined {
  const m = String(lines ?? '').match(/(\d+)(?:\s*[-–]\s*L?(\d+))?/);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return [Math.min(a, b), Math.max(a, b)];
}

export function wordingSimilarity(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  if (shared < MIN_SHARED_TOKENS) return 0;
  return shared / (a.size + b.size - shared);
}

interface Member {
  exactKey: string;
  tokens: Set<string>;
  span: [number, number];
}

interface Group {
  key: string;
  file: string;
  engines: Set<string>;
  members: Member[];
}

export interface Clusterer {
  keyFor(finding: RawFinding, exactKey: string): string;
}

function touches(a: [number, number], b: [number, number]): boolean {
  return a[0] - LINE_SLACK <= b[1] && b[0] - LINE_SLACK <= a[1];
}

export function createClusterer(): Clusterer {
  const groups: Group[] = [];
  const groupByKey = new Map<string, Group>();
  const keyByExact = new Map<string, string>();

  function join(group: Group, finding: RawFinding, member: Member | undefined): void {
    group.engines.add(finding.engine);
    if (member) group.members.push(member);
  }

  return {
    keyFor(finding, exactKey) {
      const file = (finding.file || '').trim().toLowerCase();
      const span = lineSpan(finding.lines);
      const member = file && span ? { exactKey, tokens: problemTokens(finding.problem), span } : undefined;
      const known = keyByExact.get(exactKey);
      const knownGroup = known ? groupByKey.get(known) : undefined;
      if (known && (!knownGroup || !member || knownGroup.members.every((m) => m.exactKey === exactKey || touches(m.span, member.span)))) {
        if (knownGroup) join(knownGroup, finding, member);
        return known;
      }
      let best: Group | undefined;
      let bestScore = 0;
      if (member) {
        for (const g of groups) {
          if (g.file !== file || g.engines.has(finding.engine) || !g.members.every((m) => touches(m.span, member.span))) continue;
          const score = g.members.reduce((sum, m) => sum + wordingSimilarity(member.tokens, m.tokens), 0) / g.members.length;
          if (score >= MERGE_SIMILARITY && score > bestScore) {
            best = g;
            bestScore = score;
          }
        }
      }
      if (best) {
        join(best, finding, member);
        if (!known) keyByExact.set(exactKey, best.key);
        return best.key;
      }
      const key = groupByKey.has(exactKey) ? `${exactKey}#${groups.length}` : exactKey;
      if (member) {
        const group = { key, file, engines: new Set([finding.engine]), members: [member] };
        groups.push(group);
        groupByKey.set(key, group);
      }
      if (!known) keyByExact.set(exactKey, key);
      return key;
    },
  };
}
