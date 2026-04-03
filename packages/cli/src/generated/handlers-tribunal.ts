import { join } from 'node:path';

import { mkdirSync } from 'node:fs';

import { ensureAgonHome, RUNS_DIR, scanProjectContext, tracker, appendMessage, resolveWorkingDir } from '@agon/core';

import { runTribunal } from '@agon/forge';

import type { Dispatch, HandlerContext } from '../handlers/types.js';

export async function handleTribunal(question: string, dispatch: Dispatch, ctx: HandlerContext, tribunalMode?: string): Promise<void> {
  const tribunalAbort = new AbortController();
  try {
    ensureAgonHome();
    
    if (!question) {
      dispatch({ type: 'warning', message: 'No question provided. Usage: /tribunal [mode] <question>' });
      dispatch({ type: 'info', message: 'Modes: adversarial (default), socratic, red-team, steelman, synthesis, postmortem' });
      return;
    }
    
    const active = ctx.registry.availableIds();
    if (active.length < 2) {
      dispatch({ type: 'error', message: `Tribunal needs at least 2 engines. Only found: ${active.join(', ') || 'none'}` });
      return;
    }
    
    const engines = active.slice(0, 4);
    const mode = (tribunalMode ?? 'adversarial') as any;
    const outputDir = join(RUNS_DIR, `tribunal-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
    
    const config = ctx.config;
    const tribunalCwd = resolveWorkingDir();
    const projectCtx = scanProjectContext(tribunalCwd, config.projectContext || undefined, config.contextFormat);
    const enrichedQuestion = projectCtx
      ? `${question}\n\n## PROJECT CONTEXT\n${projectCtx}`
      : question;
    
    dispatch({ type: 'header', title: `Tribunal (${mode}): ${question}` });
    dispatch({ type: 'info', message: `Engines: ${engines.join(', ')}` });
    dispatch({ type: 'info', message: `Mode: ${mode}` });
    if (projectCtx) dispatch({ type: 'info', message: `Context: ${tribunalCwd}` });
    
    dispatch({ type: 'spinner-start', message: `Engines debating (${mode})...` });
    
    ctx.setActiveAbort(tribunalAbort);
    
    let result: any;
    try {
      result = await runTribunal({
        question: enrichedQuestion,
        engines,
        rounds: 2,
        mode,
        registry: ctx.registry,
        adapter: ctx.adapter,
        timeout: 120,
        outputDir,
        onEvent: (event: any) => {
          if (tribunalAbort.signal.aborted) return;
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
    
    if (tribunalAbort.signal.aborted) {
      dispatch({ type: 'spinner-stop' });
      return;
    }
    
    dispatch({ type: 'spinner-stop', message: `${result.rounds.length} rounds complete` });
    
    for (const round of result.rounds) {
      dispatch({ type: 'header', title: `Round ${round.round}` });
      for (const pos of round.positions) {
        const arg = pos.arguments[0] ?? '';
        dispatch({
          type: 'debate-round',
          round: round.round,
          engineId: pos.engineId,
          position: pos.position,
          argument: arg,
        });
      }
    }
    
    dispatch({ type: 'header', title: mode === 'socratic' ? 'Unresolved Questions' : mode === 'red-team' ? 'Risk Register' : mode === 'synthesis' ? 'Decision Matrix' : mode === 'postmortem' ? 'Postmortem Report' : 'Verdict' });
    dispatch({ type: 'verdict', summary: result.summary });
    dispatch({ type: 'info', message: `Full debate saved: ${outputDir}` });
    
    // Save verdict to chat history for follow-ups
    appendMessage(ctx.chatSession, { role: 'user', content: `[tribunal:${mode}] ${question}`, timestamp: new Date().toISOString() });
    appendMessage(ctx.chatSession, { role: 'engine', engineId: 'tribunal', content: result.summary, timestamp: new Date().toISOString() });
    
    for (const round of result.rounds) {
      for (const pos of round.positions) {
        tracker.record(pos.engineId, question, pos.arguments.join(' '));
      }
    }
  } finally {
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  }
}

