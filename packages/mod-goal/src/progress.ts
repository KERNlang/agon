interface GoalProgressEvent { readonly type: string; readonly taskId?: string; readonly detail?: string }

const MAX_LINE_CHARS = 200;

/** Details can hold engine output, so control characters never reach the terminal. */
function formatGoalEvent(event: GoalProgressEvent): string {
  const parts = ['[goal]', event.type, event.taskId, event.detail].filter(Boolean).join(' ');
  return parts.replace(/\p{Cc}+/gu, ' ').slice(0, MAX_LINE_CHARS);
}

/** Report each journal event once; `seen` marks where a resumed journal left off. */
export function createGoalProgress(write: (line: string) => void, seen?: GoalProgressEvent) {
  let last = seen;
  return (events: readonly GoalProgressEvent[]): void => {
    for (const event of events.slice(last ? events.indexOf(last) + 1 : 0)) write(formatGoalEvent(event));
    last = events.at(-1) ?? last;
  };
}
