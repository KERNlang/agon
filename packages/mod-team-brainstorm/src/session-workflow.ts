import type { CommandResult } from '@kernlang/agon-mod-api';
import type { TeamMatchResult } from '@kernlang/agon-kernel';
import { presentTeamBrainstormEvent, presentTeamBrainstormResult } from './presentation.js';
import type { TeamBrainstormDisplayEvent } from './presentation.js';
import type { TeamBrainstormEvent } from './runtime.js';

export interface TeamBrainstormSessionHost {
  ensureHome(): void;
  engines(): { active: string[]; excluded: string[] };
  project(): { cwd: string; context: string; judge: string };
  dispatch(event: TeamBrainstormDisplayEvent | { type: 'error' | 'spinner-start' | 'spinner-stop'; message?: string }): void;
  setActiveAbort(controller: AbortController | null): void;
  appendMessage(message: { role: 'user' | 'engine'; engineId?: string; content: string; timestamp: string }): void;
}

export interface TeamBrainstormSessionExecutionContext {
  cwd: string;
  signal: AbortSignal;
  onWorkflowEvent(event: TeamBrainstormEvent): void;
}

/** Own preparation and settlement. The host supplies effects and registry execution. */
export async function runTeamBrainstormSession(
  question: string,
  membersPerSide: number | undefined,
  controller: AbortController,
  host: TeamBrainstormSessionHost,
  execute: (input: Record<string, unknown>, context: TeamBrainstormSessionExecutionContext) => Promise<CommandResult>,
): Promise<boolean> {
  const dispatch = (event: Parameters<TeamBrainstormSessionHost['dispatch']>[0]) => host.dispatch(event);
  try {
    controller.signal.throwIfAborted();
    host.ensureHome();
    if (!question) {
      dispatch({ type: 'warning', message: 'Usage: /team-brainstorm [2v2|3v3] <question>' });
      return false;
    }
    const { active, excluded } = host.engines();
    if (excluded.length) dispatch({ type: 'info', message: `Skipping disabled orchestration engines: ${excluded.join(', ')}` });
    if (active.length < 2) {
      dispatch({ type: 'error', message: `Team brainstorm needs at least 2 engines. Only found: ${active.join(', ') || 'none'}` });
      return false;
    }
    const size = membersPerSide ?? 2;
    const project = host.project();
    const enrichedQuestion = project.context ? `${question}\n\n## PROJECT CONTEXT\n${project.context}` : question;
    dispatch({ type: 'header', title: `Team Brainstorm ${size}v${size}: ${question}` });
    dispatch({ type: 'info', message: `Engines: ${active.join(', ')}` });
    dispatch({ type: 'info', message: `Cesar (judge): ${project.judge}` });
    dispatch({ type: 'spinner-start', message: 'Teams brainstorming...' });
    host.setActiveAbort(controller);
    let outputDir: string | undefined;
    const output = await execute({ question: enrichedQuestion, members: String(size),
      engines: active.join(','), timeout: '120' }, {
      cwd: project.cwd, signal: controller.signal,
      onWorkflowEvent(event) {
        if (controller.signal.aborted) return;
        if (event.type === 'team:run-started') {
          if (typeof event.data?.path !== 'string' || !event.data.path) throw new Error('Team Brainstorm run path is missing.');
          if (outputDir !== undefined) throw new Error('Team Brainstorm announced more than one run.');
          outputDir = event.data.path;
        } else presentTeamBrainstormEvent(event, dispatch);
      },
    });
    if (controller.signal.aborted) return false;
    const receiptFailed = output.exitCode !== 0 && output.failure?.code === 'TEAM_BRAINSTORM_RECEIPT_FAILED';
    const failureMessage = output.stderr?.trim() || output.failure?.message || 'Team Brainstorm failed.';
    if (output.exitCode !== 0 && !receiptFailed) throw new Error(failureMessage);
    if (!outputDir) throw new Error('Team Brainstorm completed without its run path.');
    const result = output.result as unknown as TeamMatchResult;
    if (!result || !Array.isArray(result.teams) || result.teams.length !== 2 || !result.submissions || !result.scorecards) {
      throw new Error('Team Brainstorm returned an invalid match result.');
    }
    dispatch({ type: 'spinner-stop', message: 'Team brainstorm complete' });
    presentTeamBrainstormResult(result, outputDir, dispatch);
    const [teamA, teamB] = result.teams;
    host.appendMessage({ role: 'user', content: `[team-brainstorm:${size}v${size}] ${question}`, timestamp: new Date().toISOString() });
    host.appendMessage({ role: 'engine', engineId: 'team-brainstorm',
      content: `Winner: ${result.winnerTeamId ? (result.winnerTeamId === teamA.teamId ? teamA.name : teamB.name) : 'Draw'}${receiptFailed ? `\n${failureMessage}` : ''}`,
      timestamp: new Date().toISOString() });
    if (receiptFailed) throw new Error(failureMessage);
    return true;
  } finally {
    try { dispatch({ type: 'spinner-stop' }); }
    finally { host.setActiveAbort(null); }
  }
}
