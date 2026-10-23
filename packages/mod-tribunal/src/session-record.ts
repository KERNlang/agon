import type { TribunalResult } from './runtime.js';
import type { TribunalMode, TribunalProtocol } from './modes.js';

export interface TribunalSessionEffects<Receipt> {
  now(): number;
  appendMessage(message: { role: 'user' | 'engine'; content: string; timestamp: string; engineId?: string }): void;
  addResult(result: {
    type: 'tribunal'; timestamp: string; question: string; engines: string[]; winner: null;
    data: { rounds: Array<{ round: number; engineId: string; position: string; argument: string }>; verdict: string; protocol: TribunalProtocol };
  }): void;
  recordRun(result: {
    mode: 'tribunal'; intent: string; success: true; durationMs: number;
    engineIds: string[]; completionState: 'completed';
  }): Receipt;
  formatSummary(receipt: Receipt): string;
  summaryEnabled(): boolean;
  notify(message: string): void;
  warn?(message: string): void;
  track(engineId: string, exchange: { prompt: string; response: string }): void;
}

/** Own the history and result writes. These ordered effects are not a transaction. */
export function createTribunalSessionRecord<Receipt>(options: {
  question: string; engines: readonly string[]; mode: TribunalMode; protocol: TribunalProtocol; startedAt: number; signal: AbortSignal;
}, effects: TribunalSessionEffects<Receipt>) {
  let started = false;
  return {
    complete(result: TribunalResult): void {
      if (started) throw new Error('Tribunal recording already started. Do not repeat partial history writes.');
      options.signal.throwIfAborted();
      started = true;
      const engines = [...options.engines];
      const timestamp = () => new Date(effects.now()).toISOString();
      effects.appendMessage({ role: 'user', content: `[tribunal:${options.mode}/${options.protocol}] ${options.question}`, timestamp: timestamp() });
      options.signal.throwIfAborted();
      effects.appendMessage({ role: 'engine', engineId: 'tribunal', content: result.summary, timestamp: timestamp() });
      options.signal.throwIfAborted();
      effects.addResult({ type: 'tribunal', timestamp: timestamp(), question: options.question, engines, winner: null,
        data: { rounds: result.rounds.flatMap(round => round.positions.map(position => ({
          round: round.round, engineId: position.engineId, position: position.position, argument: position.arguments[0] ?? '',
        }))), verdict: result.summary, protocol: options.protocol } });
      options.signal.throwIfAborted();
      for (const round of result.rounds) {
        for (const position of round.positions) {
          effects.track(position.engineId, { prompt: options.question, response: position.arguments.join(' ') });
          options.signal.throwIfAborted();
        }
      }
      const receipt = effects.recordRun({ mode: 'tribunal', intent: options.question, success: true,
        durationMs: effects.now() - options.startedAt, engineIds: engines, completionState: 'completed' });
      try { if (effects.summaryEnabled()) effects.notify(effects.formatSummary(receipt)); }
      catch {
        try { effects.warn?.('Tribunal receipt saved, but its summary could not be displayed.'); }
        catch { /* A diagnostic failure must not change the saved outcome. */ }
      }
    },
  };
}
