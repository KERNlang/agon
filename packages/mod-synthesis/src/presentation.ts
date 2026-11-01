import type { SynthesisResult } from './runtime.js';

export interface SynthesisDisplay {
  log(text: string): void;
  header(text: string): void;
  info(text: string): void;
  table(headers: string[], rows: string[][]): void;
  bold(text: string): string;
  green(text: string): string;
  dim(text: string): string;
}

export function synthesisRunStatus(result: SynthesisResult, options: {
  engines: readonly string[]; label?: string; startedAt: string; endedAt: string;
}) {
  const engines = options.engines.map(id => {
    const draft = result.drafts.find(item => item.engineId === id);
    const swapCount = result.swaps.filter(item => item.toEngineId === id).length;
    const score = result.scores.find(item => item.engineId === id);
    const detail = `${draft ? 'draft' : 'no-draft'}${swapCount > 0 ? `, ${swapCount} swap(s)` : ''}${score ? `, score=${score.score}` : ''}`;
    return {
      id,
      status: draft && !draft.content.startsWith('[draft failed') ? 'ok' as const : 'error' as const,
      detail: result.winner === id ? `${detail} * winner` : detail,
    };
  });
  const okCount = engines.filter(engine => engine.status === 'ok').length;
  return {
    mode: 'synthesis', ...(options.label === undefined ? {} : { label: options.label }),
    startedAt: options.startedAt, endedAt: options.endedAt, engines,
    summary: `${okCount}/${options.engines.length} drafted; winner=${result.winner}`,
    ok: okCount === options.engines.length,
  };
}

/** Emit the human report after the caller persists the run status. */
export function presentSynthesisResult(result: SynthesisResult, outputDir: string, display: SynthesisDisplay): void {
  const { bold, green, dim } = display;
  display.log('');
  display.header('Initial Drafts');
  for (const draft of result.drafts) {
    display.log(`${result.winner === draft.engineId ? green('* ') : ''}${bold(draft.engineId)}`);
    display.log(draft.content.slice(0, 400) + (draft.content.length > 400 ? '...' : ''));
    display.log('');
  }
  if (result.swaps.length > 0) {
    display.header('Swap History');
    display.table(['Round', 'From', 'To', 'Reasoning'], result.swaps.map(swap => [
      `R${swap.round}`, swap.fromEngineId, swap.toEngineId, swap.reasoning.slice(0, 60),
    ]));
  }
  if (result.scores.length > 0) {
    display.log('');
    display.header('Judge Scores');
    display.table(['Engine', 'Score', 'Conf', 'Unhandled (judge)'], result.scores.map(score => [
      score.engineId === result.winner ? green(`${score.engineId} *`) : score.engineId,
      String(score.score), typeof score.confidence === 'number' ? score.confidence.toFixed(2) : '—',
      score.unhandled ? score.unhandled.slice(0, 48) : '—',
    ]));
  }
  display.log('');
  display.header(`Winner: ${bold(result.winner)}`);
  display.log(result.judgeReasoning);
  display.log('');
  display.info(dim(`Full output saved: ${outputDir}`));
}
