import type { ThinkResult } from './thinking.js';

export interface ThinkDisplay {
  log(text: string): void;
  header(text: string): void;
  info(text: string): void;
  bold(text: string): string;
  dim(text: string): string;
}

export function thoughtGlyph(kind: string): string {
  return kind === 'critique' ? '🔍' : kind === 'revision' ? '✏️' : kind === 'question' ? '❓' : kind === 'decision' ? '✅' : kind === 'hypothesis' ? '🔬' : kind === 'decompose' ? '🧩' : '💭';
}

export function presentThinkResult(result: ThinkResult, options: {
  quiet: boolean; goal: boolean; strategy: string; outputDir: string;
}, display: ThinkDisplay): void {
  const { quiet, goal, strategy, outputDir } = options;
  const { bold, dim, info } = display;
    if (!quiet) {
      for (const t of result.thoughts) {
        const flag = t.grounded === false ? dim('  ⚠ ungrounded') : '';
        const score = typeof t.branchScore === 'number' ? `:${t.branchScore}` : '';
        const branchTag = t.branchId ? dim(` ⟜${t.branchId}${score}`) : '';
        const prunedTag = t.pruned ? dim(' ✂ pruned') : '';
        const line = `${thoughtGlyph(t.kind)} ${bold(`${t.thoughtNumber}/${t.totalThoughts}`)} ${dim(`[${t.kind}]`)}${branchTag} ${t.thought}${flag}${prunedTag}`;
        display.log(t.pruned ? dim(line) : line);
      }
      display.log('');
      if (result.chosenBranch) {
        display.log(`${bold('Chosen branch')}: ${result.chosenBranch}`);
        display.log('');
      }
    }

    if (result.summary) {
      display.log(bold('Summary'));
      display.log(result.summary);
      display.log('');
    }

    if (result.openQuestions.length > 0) {
      display.log(bold('Open questions'));
      for (const q of result.openQuestions) display.log(`  ❓ ${q}`);
      display.log('');
    }

    if (!quiet && result.groundingIssues.length > 0) {
      display.log(dim('Grounding warnings:'));
      for (const g of result.groundingIssues) display.log(dim(`  ⚠ ${g}`));
      display.log('');
    }

    if (!quiet && !result.protocolValid) {
      display.log(dim(`⚠ ${strategy} protocol not fully satisfied (machine validation failed).`));
      display.log('');
    }

    if (result.adversarialCritique) {
      display.log(bold(`Adversarial critique${result.criticEngineId ? ` (${result.criticEngineId})` : ''}`));
      display.log(result.adversarialCritique);
      display.log('');
    }

    if (goal) {
      display.log(bold('Handoff → goal'));
      display.log(`agon goal ${JSON.stringify(result.refinedSpec)}`);
      display.log('');
    }

    if (!quiet) {
      info(dim(`Saved: ${outputDir}`));
      display.log('AGON_SUMMARY: 1/1 succeeded');
    }
}
