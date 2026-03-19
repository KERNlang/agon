import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  ensureAgonHome,
  RUNS_DIR,
  scanProjectContext,
  tracker,
} from '@agon/core';
import { ENGINE_COLORS } from '../output.js';
import type { Dispatch, HandlerContext, EngineProgress } from './types.js';

export async function handleCampfire(
  topic: string,
  dispatch: Dispatch,
  ctx: HandlerContext,
): Promise<void> {
  ensureAgonHome();

  const engines = ctx.activeEngines();
  if (engines.length === 0) {
    dispatch({ type: 'error', message: 'No engines available.' });
    return;
  }

  const config = ctx.config;
  const projectCtx = scanProjectContext(process.cwd(), config.projectContext || undefined, config.contextFormat);

  const prompt = [
    `## CAMPFIRE`,
    `Topic: ${topic || 'open discussion'}`,
    '',
    projectCtx ? `## Project Context\n${projectCtx}\n` : '',
    `## Rules`,
    `This is a campfire — no competition, no ranking, no winners.`,
    `Think freely. Share ideas, wild thoughts, "what if" scenarios.`,
    `Be honest. Say "I'm not sure" if you're not sure.`,
    `Build on the topic. Be interesting, not just useful.`,
    `Keep it concise — 3-5 paragraphs max.`,
  ].filter(Boolean).join('\n');

  dispatch({ type: 'header', title: 'Campfire — no competition, just thinking together' });
  if (topic) dispatch({ type: 'info', message: `Topic: ${topic}` });

  const outputDir = join(RUNS_DIR, `campfire-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  const cfAbort = new AbortController();
  ctx.setActiveAbort(cfAbort);

  const cfStatus: Record<string, 'thinking' | 'done' | 'failed'> = {};
  for (const id of engines) cfStatus[id] = 'thinking';

  const startTime = Date.now();
  const progressInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const progress: EngineProgress[] = engines.map((id) => ({
      id,
      status: cfStatus[id] === 'done' ? 'done' : cfStatus[id] === 'failed' ? 'missed' : `thinking… ${elapsed}s`,
      elapsed,
      done: cfStatus[id] === 'done',
      failed: cfStatus[id] === 'failed',
    }));
    dispatch({ type: 'progress-update', engines: progress });
  }, 250);

  let progressCleared = false;
  function clearProgress(): void {
    if (progressCleared) return;
    progressCleared = true;
    clearInterval(progressInterval);
    dispatch({ type: 'progress-clear' });
  }

  const allDone = engines.map(async (engineId) => {
    const engine = ctx.registry.get(engineId);
    try {
      const result = await ctx.adapter.dispatch({
        engine,
        prompt,
        cwd: process.cwd(),
        mode: 'exec',
        timeout: 120,
        outputDir,
        signal: cfAbort.signal,
      });
      cfStatus[engineId] = 'done';
      clearProgress();

      const color = ENGINE_COLORS[engineId] ?? 245;
      dispatch({ type: 'engine-block', engineId, color, content: result.stdout.trim() });
      tracker.record(engineId, topic, result.stdout);
    } catch {
      cfStatus[engineId] = 'failed';
    }
  });

  await Promise.all(allDone);
  clearProgress();
  ctx.setActiveAbort(null);
}
