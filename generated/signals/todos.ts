// @kern-source: todos:9
/**
 * A single rolling task — pending, running, done, failed, cancelled.
 */
export interface Todo {
  id: string;
  text: string;
  state: 'pending'|'running'|'done'|'failed'|'cancelled';
  kind?: string;
  note?: string;
}

// @kern-source: todos:17
/**
 * Replace the todo list. Returns a fresh slice so React identity changes.
 */
export function setTodos(todos: Todo[]): Todo[] {
  return todos.slice();
}

// @kern-source: todos:23
/**
 * Patch a single todo's state (and optionally note). No-op if id is unknown.
 */
export function updateTodoState(todos: Todo[], id: string, state: string, note: string|undefined): Todo[] {
  return todos.map((t) =>
    t.id === id
      ? { ...t, state: state as Todo['state'], note: note !== undefined ? note : t.note }
      : t
  );
}

// @kern-source: todos:33
/**
 * Wipe the todo list.
 */
export function clearTodos(): Todo[] {
  return [];
}

// @kern-source: todos:39
/**
 * Convert plan steps into todo items so an executing plan auto-populates the rolling list. Plan-step states map directly; anything else falls through to 'pending'.
 */
export function todosFromPlanSteps(steps: any[]): Todo[] {
  const allowed = new Set(['pending', 'running', 'done', 'failed', 'cancelled']);
  return steps.map((s: any) => ({
    id: String(s.id),
    text: String(s.description ?? s.id),
    state: (allowed.has(s.state) ? s.state : 'pending') as Todo['state'],
    kind: s.type,
  }));
}

