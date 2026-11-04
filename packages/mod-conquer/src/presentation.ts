import type { ConquerInvocationContext } from './host.js';
import type { ConquerPublicationResult } from './publication.js';
import type { ConquerPullRequest } from './pull-request.js';

export interface ConquerPublicationOutput {
  publication?: ConquerPublicationResult;
  pullRequest?: ConquerPullRequest;
}

/** Published work needs PR review, not another commit. */
export function renderConquerPublication(result: ConquerPublicationOutput, info: (message: string) => void): boolean {
  if (!result.publication?.ok) return false;
  info(`Pushed ${result.publication.branch}.`);
  if (result.pullRequest) {
    info(result.pullRequest.title);
    info(result.pullRequest.body);
    info(result.pullRequest.mergeHint);
  }
  return true;
}

export type ConquerDisplay = (event: { type: 'header'; title: string }
  | { type: 'info' | 'warning'; message: string }) => void;
export interface ConquerProgressState {
  builder: string;
  advisors: string[];
  worktree: { branch: string; path: string };
}

/** Render progress shared by the terminal and interactive session. */
export function renderConquerProgress(
  event: Parameters<NonNullable<ConquerInvocationContext['onWorkflowEvent']>>[0],
  dispatch: ConquerDisplay,
  onStart: (state: ConquerProgressState) => void,
): void {
  if (event.type !== 'conquer:start' && event.type !== 'conquer:turn') return;
  if (!event.data) throw new Error('Conquer returned invalid session metadata.');
  const data = event.data;
  if (event.type === 'conquer:turn') {
    const detail = typeof data.detail === 'string' ? data.detail : '';
    dispatch({ type: 'info', message: `turn ${data.n} · ${data.action}${data.action === 'consult' || data.action === 'done-check' ? ` — ${detail.slice(0, 80)}` : ''}` });
    return;
  }
  const retained = data.worktree as { branch?: unknown; path?: unknown } | undefined;
  if (typeof data.builder !== 'string' || !Array.isArray(data.advisors)
    || !data.advisors.every(id => typeof id === 'string')
    || typeof retained?.branch !== 'string' || typeof retained.path !== 'string') {
    throw new Error('Conquer returned invalid session metadata.');
  }
  const state = { builder: data.builder, advisors: [...data.advisors],
    worktree: { branch: retained.branch, path: retained.path } };
  // Retain recovery metadata before a display callback can fail or cancel.
  onStart(state);
  dispatch({ type: 'header', title: `Conquer · builder=${state.builder} · advisors=${state.advisors.join(',') || '(none)'}` });
  const task = typeof data.task === 'string' ? data.task : '';
  for (const message of [task.length > 120 ? task.slice(0, 120) + '…' : task,
    `gate: ${data.gate}`, `isolated branch: ${state.worktree.branch}`, `worktree: ${state.worktree.path}`]) {
    dispatch({ type: 'info', message });
  }
  if (data.dirtySourceExcluded) dispatch({ type: 'warning', message: 'The source checkout has uncommitted work. It remains untouched and is not included in this HEAD-based Conquer branch.' });
}
