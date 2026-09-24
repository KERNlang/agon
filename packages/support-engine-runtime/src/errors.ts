export const AGON_MODE_NAMES: readonly string[] = ['forge', 'brainstorm', 'tribunal', 'campfire', 'council', 'synthesis', 'conquer', 'goal', 'agent', 'pipeline', 'review', 'nero', 'think'];

export class AgonError extends Error {
  constructor(message: string) { super(message); this.name = 'AgonError' }
}

export class EngineNotFoundError extends AgonError {
  constructor(
    public readonly engineId: string,
    public readonly installHint?: string,
    public readonly missingBinary?: string,
  ) {
    const modeId = engineId.toLowerCase();
    const binaryMessage = missingBinary ? ` — binary "${missingBinary}" not found on PATH${installHint ? `. Install: ${installHint}` : ''}` : '';
    const hint = AGON_MODE_NAMES.includes(modeId)
      ? `. "${engineId}" is an Agon mode (a command), not an engine — run /${modeId} instead. Engines are backends like codex, claude, or agy.`
      : binaryMessage || (installHint ? `. Install: ${installHint}` : '');
    super(`Engine "${engineId}" not found${hint}`);
    this.name = 'EngineNotFoundError';
  }
}

export class EngineTimeoutError extends AgonError {
  constructor(public readonly engineId: string, public readonly timeoutMs: number) {
    super(`Engine "${engineId}" timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'EngineTimeoutError';
  }
}
