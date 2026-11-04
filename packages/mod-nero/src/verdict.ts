/** Read the last verdict marker. Earlier markers can appear in the reasoning. */
export function parseNeroVerdict(text: string): 'flawed' | 'proceed-with-caution' | 'sound' | 'unknown' {
  const matches = [...text.matchAll(/VERDICT:\s*(FLAWED|PROCEED WITH CAUTION|SOUND)/gi)];
  if (matches.length === 0) return 'unknown';
  const v = matches[matches.length - 1][1].toUpperCase();
  if (v === 'FLAWED') return 'flawed';
  if (v === 'SOUND') return 'sound';
  return 'proceed-with-caution';
}
