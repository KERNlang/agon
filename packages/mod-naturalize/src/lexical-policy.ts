/** Count lexical changes, not punctuation or capitalization changes. */
export function tokenizeWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9']+/i).filter((w) => w.length > 0);
}

/** Compare word counts without treating reordering as a rewrite. */
export function wordDiffStats(before: string, after: string): {wordsBefore:number,wordsAfter:number,changedWords:number,unchangedRatio:number} {
  const a = tokenizeWords(before);
  const b = tokenizeWords(after);
  const counts = new Map<string, number>();
  for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of b) {
    const n = counts.get(w) ?? 0;
    if (n > 0) { shared += 1; counts.set(w, n - 1); }
  }
  const max = Math.max(a.length, b.length);
  return {
    wordsBefore: a.length,
    wordsAfter: b.length,
    changedWords: max - shared,
    unchangedRatio: max === 0 ? 1 : shared / max,
  };
}
