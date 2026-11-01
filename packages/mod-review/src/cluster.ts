import type { RawFinding } from './consensus.js';

export const MERGE_SIMILARITY = 0.3;

export const LINE_SLACK = 2;

const STOP_WORDS = new Set((
  'the a an and or of to in on for is are be by with without this that it its as at from into not no can when whenever '
  + 'which while so than then but if any all only also has have was were will would should could may might does do did same '
  + 'instead before after because there their them they user users code value values line lines function call calls '
  + 'returned return returns'
).split(' '));

const SUFFIXES = ['ing', 'ed', 'es', 's', 'ly'];

function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

export function problemTokens(text: string | undefined): Set<string> {
  const words = (text || '').toLowerCase().split(/[^a-z0-9]+/);
  return new Set(words.filter((w) => w.length >= 3 && !STOP_WORDS.has(w)).map(stem));
}

export function lineSpan(lines: string | undefined): [number, number] | undefined {
  const nums = (String(lines ?? '').match(/\d+/g) || []).slice(0, 2).map(Number);
  if (nums.length === 0) return undefined;
  return [Math.min(...nums), Math.max(...nums)];
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

interface Group {
  key: string;
  file: string;
  span: [number, number];
  members: Set<string>[];
}

export interface Clusterer {
  keyFor(finding: RawFinding, exactKey: string): string;
}

export function createClusterer(): Clusterer {
  const groups: Group[] = [];
  const byExactKey = new Map<string, string>();
  return {
    keyFor(finding, exactKey) {
      const known = byExactKey.get(exactKey);
      if (known) return known;
      const file = (finding.file || '').trim().toLowerCase();
      const span = lineSpan(finding.lines);
      const tokens = problemTokens(finding.problem);
      let best: Group | undefined;
      let bestScore = 0;
      if (file && span) {
        for (const g of groups) {
          if (g.file !== file || span[0] - LINE_SLACK > g.span[1] || g.span[0] - LINE_SLACK > span[1]) continue;
          const score = g.members.reduce((sum, m) => sum + overlap(tokens, m), 0) / g.members.length;
          if (score >= MERGE_SIMILARITY && score > bestScore) {
            best = g;
            bestScore = score;
          }
        }
      }
      if (best) {
        best.members.push(tokens);
        best.span = [Math.min(best.span[0], span![0]), Math.max(best.span[1], span![1])];
        byExactKey.set(exactKey, best.key);
        return best.key;
      }
      if (file && span) groups.push({ key: exactKey, file, span, members: [tokens] });
      byExactKey.set(exactKey, exactKey);
      return exactKey;
    },
  };
}
