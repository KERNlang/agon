export type ReplStateState = 'idle' | 'busy' | 'streaming' | 'questioning' | 'reviewing';

export class ReplStateStateError extends Error {
  constructor(
    public readonly expected: string | string[],
    public readonly actual: string,
  ) {
    const expectedStr = Array.isArray(expected) ? expected.join(' | ') : expected;
    super(`Invalid replstate state: expected ${expectedStr}, got ${actual}`);
    this.name = 'ReplStateStateError';
  }
}

/** idle → busy */
export function startCommandReplState<T extends { state: ReplStateState }>(entity: T): T {
  if (entity.state !== 'idle') {
    throw new ReplStateStateError('idle', entity.state);
  }
  return { ...entity, state: 'busy' as ReplStateState };
}






/** busy|streaming|questioning → idle */
export function finishReplState<T extends { state: ReplStateState }>(entity: T): T {
  const validStates: ReplStateState[] = ['busy', 'streaming', 'questioning'];
  if (!validStates.includes(entity.state)) {
    throw new ReplStateStateError(validStates, entity.state);
  }
  return { ...entity, state: 'idle' as ReplStateState };
}

/** busy|streaming|questioning → idle */
export function cancelReplState<T extends { state: ReplStateState }>(entity: T): T {
  const validStates: ReplStateState[] = ['busy', 'streaming', 'questioning'];
  if (!validStates.includes(entity.state)) {
    throw new ReplStateStateError(validStates, entity.state);
  }
  return { ...entity, state: 'idle' as ReplStateState };
}









