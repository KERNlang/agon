import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  ensureAgonHome,
  RUNS_DIR,
  scanProjectContext,
  tracker,
} from '@agon/core';
import { runBrainstorm } from '@agon/forge';
import { ENGINE_COLORS } from '../output.js';
import type { Dispatch, HandlerContext, EngineProgress } from './types.js';

export async function handleBrainstorm(
  question: string,
  dispatch: Dispatch,
  ctx: HandlerContext,
): Promise<void> {
  ensureAgonHome();

  if (!question) {
    dispatch({ type: 'warning', message: 'No question provided. Usage: "best approach for caching?" or /brainstorm <question>' });
    return;
  }

  const engines = ctx.activeEngines();
  if (engines.length === 0) {
    dispatch({ type: 'error', message: 'No engines available.' });
    return;
  }

  const outputDir = join(RUNS_DIR, `brainstorm-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  const config = ctx.config;
  const projectCtx = scanProjectContext(process.cwd(), config.projectContext || undefined, config.contextFormat);

  dispatch({ type: 'header', title: `Brainstorm: ${question}` });
  dispatch({ type: 'info', message: `Engines: ${engines.join(', ')}` });
  if (projectCtx) dispatch({ type: 'info', message: `Context: ${process.cwd()}` });

  const bsAbort = new AbortController();
  ctx.setActiveAbort(bsAbort);

  const startTime = Date.now();
  const progressInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const progress: EngineProgress[] = engines.map((id) => ({
      id,
      status: `drafting… ${elapsed}s`,
      elapsed,
      done: false,
      failed: false,
    }));
    dispatch({ type: 'progress-update', engines: progress });
  }, 250);

  let result;
  try {
    result = await runBrainstorm({
      question,
      context: projectCtx,
      engines,
      registry: ctx.registry,
      adapter: ctx.adapter,
      timeout: 120,
      outputDir,
      signal: bsAbort.signal,
    });
  } catch (err) {
    clearInterval(progressInterval);
    dispatch({ type: 'progress-clear' });
    ctx.setActiveAbort(null);
    throw err;
  }

  ctx.setActiveAbort(null);
  clearInterval(progressInterval);
  dispatch({ type: 'progress-clear' });

  // Final status
  const finalProgress: EngineProgress[] = engines.map((id) => {
    const bid = result.bids.find((b) => b.engineId === id);
    const isWinner = bid?.engineId === result.winner;
    return {
      id,
      status: bid ? (isWinner ? '★ best draft' : '✓ done') : '✗ no response',
      elapsed: Math.floor((Date.now() - startTime) / 1000),
      done: !!bid,
      failed: !bid,
    };
  });
  dispatch({ type: 'progress-update', engines: finalProgress });

  // Show each engine's draft
  dispatch({ type: 'separator' });
  for (let i = 0; i < result.bids.length; i++) {
    const bid = result.bids[i];
    const isWinner = bid.engineId === result.winner;
    dispatch({
      type: 'kern-draft',
      engineId: bid.engineId,
      content: bid.reasoning + (bid.approach ? '\n' + bid.approach : ''),
      critique: isWinner ? '★ best draft' : undefined,
    });
  }

  // Winner's full response
  dispatch({ type: 'separator' });
  dispatch({ type: 'engine-block', engineId: result.winner, color: ENGINE_COLORS[result.winner] ?? 245, content: result.response });

  // Track tokens
  for (const bid of result.bids) {
    tracker.record(bid.engineId, question, bid.reasoning);
  }
  tracker.record(result.winner, question, result.response);
}
