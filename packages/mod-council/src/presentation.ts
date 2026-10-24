import type { CouncilResult } from './runtime.js';

export interface CouncilDisplay {
  log(text: string): void;
  header(text: string): void;
  info(text: string): void;
  bold(text: string): string;
  dim(text: string): string;
}

export function chairmanPickLabel(reason: string): string {
  if (reason === 'forced') return 'forced';
  if (reason === 'cesar') return 'cesar-chaired (2-engine council)';
  if (reason === 'random') return 'random — no rating yet';
  if (reason === 'top-rated') return 'top-rated';
  return reason;
}

export function councilRunStatus(result: CouncilResult, options: {
  label?: string; startedAt: string; endedAt: string; requested: string[]; timeoutSec: number;
}) {
  const engines = [
    { id: result.chairmanId || '(none)', status: result.ok && (result.actingChairmanId || result.chairmanId) === result.chairmanId ? 'ok' as const : 'error' as const,
      detail: result.actingChairmanId && result.actingChairmanId !== result.chairmanId
        ? `chairman (${chairmanPickLabel(result.chairmanReason)}) — failed; ${result.actingChairmanId} acted`
        : `chairman (${chairmanPickLabel(result.chairmanReason)})` },
    ...result.seats.map(s => ({
      id: s.engineId,
      status: s.response && s.response !== '(no response)' ? 'ok' as const : 'error' as const,
      detail: `${s.role}${s.critique ? ' +critique' : ''}`,
    })),
  ];
  return {
    mode: 'council', label: options.label, startedAt: options.startedAt, endedAt: options.endedAt, engines,
    summary: result.ok
      ? `${result.seats.length} advisors, chaired by ${result.actingChairmanId || result.chairmanId}${result.actingChairmanId && result.actingChairmanId !== result.chairmanId ? ` (acting; seated ${result.chairmanId} failed)` : ''}${result.confidence != null ? ` · ${result.confidence}% confidence` : ''}`
      : 'council produced no usable verdict',
    ok: result.ok, requested: options.requested, timeoutSec: options.timeoutSec,
  };
}

/** Render the result body. The caller persists status before this output. */
export function presentCouncilResult(result: CouncilResult, options: { json: boolean; quiet: boolean }, display: CouncilDisplay): void {
  if (options.json) { display.log(JSON.stringify(result, null, 2)); return; }
  if (options.quiet) { display.log(result.verdict); return; }
  const { bold, dim, info } = display;
  const seating = result.seats.map(s => `${s.role}=${s.engineId}`).join(', ');
  info(dim(`Chair: ${result.chairmanId} (${chairmanPickLabel(result.chairmanReason)})  ·  ${seating}`));
  display.log('');
  if (result.brief && result.brief !== result.question) {
    display.log(bold('Decision brief'));
    display.log(result.brief);
    display.log('');
  }
  for (const s of result.seats) {
    display.log(bold(`${s.role} — ${s.engineId}`));
    display.log(s.response || '(no response)');
    if (s.critique) {
      display.log('');
      display.log(dim(`↳ ${s.role} critiquing ${s.critiquedRole}:`));
      display.log(s.critique);
    }
    display.log('');
  }
  display.log(bold('━━━ Chairman verdict ━━━'));
  display.log(result.verdict);
  display.log('');
  if (result.confidence != null) display.log(bold(`Confidence: ${result.confidence}%`));
  if (result.warnings.length > 0) {
    display.log('');
    for (const w of result.warnings) info(dim(`⚠ ${w}`));
  }
  display.log('');
  info(dim(`Saved: ${result.outputDir}`));
}
