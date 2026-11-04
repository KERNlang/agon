export interface SynthesisScore {
  engineId: string;
  score: number;
  breakdown: string;
  confidence?: number;
  unhandled?: string;
}

export function normalizeSynthesisWinner(raw: string, engineIds: string[]): string {
  if (engineIds.length === 0) return '';
  const rawWinner = String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .replace(/[.。]+$/g, '')
    .replace(/^(?:\*\*|__|\*|_)\s*|\s*(?:\*\*|__|\*|_)$/g, '')
    .trim()
    .replace(/[.。]+$/g, '');
  const entryMatch = rawWinner.match(/^(?:entry[_\s-]*)?(\d+)$/i);
  const entryIndex = entryMatch ? parseInt(entryMatch[1], 10) - 1 : -1;
  return entryIndex >= 0 && engineIds[entryIndex]
    ? engineIds[entryIndex]
    : engineIds.find((id) => id.toLowerCase() === rawWinner.toLowerCase()) ?? engineIds[0];
}

export function parseSynthesisJudgeOutput(text: string, engineIds: string[]): {scores:SynthesisScore[];winner:string;reasoning:string} {
  const labelWrap = '(?:\\*\\*|__|\\*|_)?';
  const labelPattern = (name: string, label?: string) => {
    const suffix = label ? `[_\\s-]*${label}` : '';
    return `${labelWrap}\\s*${name}${suffix}\\s*${labelWrap}\\s*:\\s*${labelWrap}`;
  };
  const scores: SynthesisScore[] = [];
  for (let i = 0; i < engineIds.length; i += 1) {
    const label = `${i + 1}`;
    const re = new RegExp(`${labelPattern('SCORE', label)}\\s*(\\d{1,3})`, 'i');
    const m = text.match(re);

    let confidence: number | undefined;
    const confMatch = text.match(new RegExp(`${labelPattern('CONFIDENCE', label)}\\s*([0-9]*\\.?[0-9]+)\\s*%?`, 'i'));
    if (confMatch) {
      let v = parseFloat(confMatch[1]);
      if (v > 1) v = v / 100; // tolerate 0-100 / percentage outputs (e.g. "75" or "75%") instead of 0-1
      confidence = Math.max(0, Math.min(1, v));
    }

    const unhMatch = text.match(new RegExp(`${labelPattern('UNHANDLED', label)}\\s*(.+)`, 'i'));
    const unhandledRaw = unhMatch ? unhMatch[1].trim().replace(/^["']|["']$/g, '').trim() : undefined;
    // Suppress "none" and its punctuated variants ("None.", "NONE!", "none ").
    const unhandled = unhandledRaw && !/^none[.!\s]*$/i.test(unhandledRaw) ? unhandledRaw : undefined;

    scores.push({
      engineId: engineIds[i],
      score: m ? Math.min(parseInt(m[1], 10), 100) : 0,
      breakdown: '',
      confidence,
      unhandled,
    });
  }

  const winnerMatch = text.match(new RegExp(`${labelPattern('WINNER')}\\s*"?([^"\\n]+)"?`, 'i'));
  const winner = normalizeSynthesisWinner(winnerMatch ? winnerMatch[1] : '', engineIds);

  const reasonMatch = text.match(new RegExp(`${labelPattern('REASONING')}\\s*"?([^"\\n]+)"?`, 'i'));
  const reasoning = reasonMatch ? reasonMatch[1].trim() : 'No reasoning provided';

  return { scores, winner, reasoning };
}
