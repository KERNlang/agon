import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  ensureAgonHome,
  RUNS_DIR,
  scanProjectContext,
  tracker,
} from '@agon/core';
import { runTribunal } from '@agon/forge';
import type { Dispatch, HandlerContext } from './types.js';

export async function handleTribunal(
  question: string,
  dispatch: Dispatch,
  ctx: HandlerContext,
): Promise<void> {
  ensureAgonHome();

  if (!question) {
    dispatch({ type: 'warning', message: 'No question provided. Usage: "should we use REST or GraphQL?" or /tribunal <question>' });
    return;
  }

  const active = ctx.activeEngines();
  if (active.length < 2) {
    dispatch({ type: 'error', message: `Tribunal needs at least 2 engines. Only found: ${active.join(', ') || 'none'}` });
    return;
  }

  const engines = active.slice(0, 4);
  const outputDir = join(RUNS_DIR, `tribunal-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  const config = ctx.config;
  const projectCtx = scanProjectContext(process.cwd(), config.projectContext || undefined, config.contextFormat);
  const enrichedQuestion = projectCtx
    ? `${question}\n\n## PROJECT CONTEXT\n${projectCtx}`
    : question;

  dispatch({ type: 'header', title: `Tribunal: ${question}` });
  dispatch({ type: 'info', message: `Engines: ${engines.join(', ')}` });
  if (projectCtx) dispatch({ type: 'info', message: `Context: ${process.cwd()}` });
  dispatch({ type: 'info', message: 'Rounds: 2' });

  dispatch({ type: 'spinner-start', message: 'Engines debating...' });

  let result;
  try {
    result = await runTribunal({
      question: enrichedQuestion,
      engines,
      rounds: 2,
      registry: ctx.registry,
      adapter: ctx.adapter,
      timeout: 120,
      outputDir,
      onEvent: (event) => {
        if (event.data?.round) {
          const engineId = event.engineId;
          const position = event.data?.position;
          if (engineId && position) {
            dispatch({ type: 'spinner-update', message: `Round ${event.data.round}: ${String(engineId)} (${String(position)}) arguing...` });
          }
        }
      },
    });
  } catch (err) {
    dispatch({ type: 'spinner-stop' });
    throw err;
  }

  dispatch({ type: 'spinner-stop', message: `${result.rounds.length} rounds complete` });

  // Display each round
  for (const round of result.rounds) {
    dispatch({ type: 'header', title: `Round ${round.round}` });
    for (const pos of round.positions) {
      const arg = pos.arguments[0] ?? '';
      const truncated = arg.length > 500 ? arg.slice(0, 500) + '\n...(truncated)' : arg;
      dispatch({
        type: 'debate-round',
        round: round.round,
        engineId: pos.engineId,
        position: pos.position,
        argument: truncated,
      });
    }
  }

  // Verdict
  dispatch({ type: 'header', title: 'Verdict' });
  dispatch({ type: 'verdict', summary: result.summary });
  dispatch({ type: 'info', message: `Full debate saved: ${outputDir}` });

  // Track tokens
  for (const round of result.rounds) {
    for (const pos of round.positions) {
      tracker.record(pos.engineId, question, pos.arguments.join(' '));
    }
  }
}
