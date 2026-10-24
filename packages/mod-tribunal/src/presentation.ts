import type { TribunalResult } from './runtime.js';

export interface TribunalFailure {
  engineId: string;
  phase: string;
  error: string;
}

export interface TribunalOutput {
  log(text: string): void;
  header(text: string): void;
  warn(text: string): void;
  info(text: string): void;
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
}

/** Render the debate without changing run state or terminal styling policy. */
export function renderTribunalResult(
  result: TribunalResult,
  failedEngines: readonly TribunalFailure[],
  outputDir: string,
  output: TribunalOutput,
): void {
  const { log, header, warn, info, bold, dim, red } = output;
  for (const round of result.rounds) {
    log('');
    header(`Round ${round.round}`);
    for (const pos of round.positions) {
      log('');
      log(`  ${bold(pos.engineId)} ${dim(`(${pos.position})`)}`);
      const arg = pos.arguments[0] ?? '';
      const lines = arg.slice(0, 500).split('\n');
      for (const line of lines) log(`  ${line}`);
      if (arg.length > 500) log(`  ${dim('...(truncated)')}`);
    }
  }

  if (failedEngines.length > 0) {
    const byEngine = new Map<string, Array<{ phase: string; error: string }>>();
    for (const failure of failedEngines) {
      const failures = byEngine.get(failure.engineId) ?? [];
      failures.push({ phase: failure.phase, error: failure.error });
      byEngine.set(failure.engineId, failures);
    }
    log('');
    header('Engines that hit errors');
    for (const [engineId, failures] of byEngine.entries()) {
      warn(`${bold(engineId)} (${failures.length} failure${failures.length > 1 ? 's' : ''})`);
      for (const failure of failures) {
        const snippet = failure.error.length > 160 ? `${failure.error.slice(0, 160)}…` : failure.error;
        log(`  ${dim(failure.phase)}: ${red(snippet)}`);
      }
    }
  }

  if (result.panelHealth?.banner) {
    log('');
    warn(result.panelHealth.banner);
  }

  log('');
  header('Verdict');
  log('');
  log(result.summary);
  log('');
  info(dim(`Full debate saved: ${outputDir}`));
}
