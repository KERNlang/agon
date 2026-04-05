import { join } from 'node:path';

import { mkdirSync } from 'node:fs';

import { ensureAgonHome, RUNS_DIR, scanProjectContext, tracker, appendMessage, resolveWorkingDir, loadConfig } from '@agon/core';

import { runTeamTribunal } from '@agon/forge';

import type { TribunalMode } from '@agon/forge';

import type { Dispatch, HandlerContext } from '../handlers/types.js';

export async function handleTeamTribunal(question: string, dispatch: Dispatch, ctx: HandlerContext, tribunalMode?: string, membersPerSide?: number): Promise<void> {
  const teamAbort = new AbortController();
  try {
    ensureAgonHome();
    
    if (!question) {
      dispatch({ type: 'warning', message: 'Usage: /team-tribunal [2v2|3v3] [mode] <question>' });
      dispatch({ type: 'info', message: 'Modes: adversarial (default), socratic, red-team, steelman, synthesis, postmortem' });
      return;
    }
    
    const active = ctx.registry.availableIds();
    if (active.length < 2) {
      dispatch({ type: 'error', message: `Team tribunal needs at least 2 engines. Only found: ${active.join(', ') || 'none'}` });
      return;
    }
    
    const size = membersPerSide ?? 2;
    const mode = (tribunalMode ?? 'adversarial') as TribunalMode;
    const outputDir = join(RUNS_DIR, `team-tribunal-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
    
    const config = loadConfig(resolveWorkingDir());
    const tribunalCwd = resolveWorkingDir();
    const projectCtx = scanProjectContext(tribunalCwd, config.projectContext || undefined, config.contextFormat);
    const enrichedQuestion = projectCtx
      ? `${question}\n\n## PROJECT CONTEXT\n${projectCtx}`
      : question;
    
    dispatch({ type: 'header', title: `Team Tribunal ${size}v${size} (${mode}): ${question}` });
    dispatch({ type: 'info', message: `Engines: ${active.join(', ')}` });
    dispatch({ type: 'info', message: `Cesar (judge): ${config.cesarEngine}` });
    dispatch({ type: 'info', message: `Mode: ${mode} — engines can appear on both teams` });
    
    dispatch({ type: 'spinner-start', message: `Composing teams and debating (${mode})...` });
    
    ctx.setActiveAbort(teamAbort);
    
    let result: any;
    try {
      result = await runTeamTribunal({
        question: enrichedQuestion,
        membersPerSide: size,
        rounds: 2,
        mode,
        registry: ctx.registry,
        adapter: ctx.adapter,
        timeout: 120,
        outputDir,
        signal: teamAbort.signal,
        onEvent: (event: any) => {
          if (teamAbort.signal.aborted) return;
          if (event.type === 'team:compose' && event.data?.teams) {
            const [tA, tB] = event.data.teams;
            dispatch({ type: 'info', message: `Team Alpha: ${tA.members.map((m: any) => `${m.engineId}(${m.role})`).join(' + ')}` });
            dispatch({ type: 'info', message: `Team Beta: ${tB.members.map((m: any) => `${m.engineId}(${m.role})`).join(' + ')}` });
          }
          if (event.type === 'team:member-dispatch' && event.data) {
            dispatch({ type: 'spinner-update', message: `${String(event.data.teamId)}: ${String(event.data.engineId)} (${String(event.data.role)}) working...` });
          }
          if (event.type === 'team:score' && event.data) {
            dispatch({ type: 'info', message: `${String(event.data.teamId)} scored: ${String(event.data.score)}` });
          }
        },
      });
    } catch (err) {
      dispatch({ type: 'spinner-stop' });
      throw err;
    }
    
    if (teamAbort.signal.aborted) {
      dispatch({ type: 'spinner-stop' });
      return;
    }
    
    dispatch({ type: 'spinner-stop', message: 'Team debate complete' });
    
    // Show results
    const [teamA, teamB] = result.teams;
    const subA = result.submissions[teamA.teamId];
    const subB = result.submissions[teamB.teamId];
    const cardA = result.scorecards[teamA.teamId];
    const cardB = result.scorecards[teamB.teamId];
    
    dispatch({ type: 'header', title: `Team Alpha — ${teamA.name}` });
    dispatch({ type: 'info', message: `Lineup: ${teamA.members.map((m: any) => `${m.engineId}(${m.role})`).join(' + ')} | ELO: ${teamA.aggregateElo}` });
    dispatch({ type: 'verdict', summary: String(subA?.finalOutput ?? '(no submission)') });
    dispatch({ type: 'info', message: `Score: ${cardA?.score ?? '?'}/100` });
    
    dispatch({ type: 'header', title: `Team Beta — ${teamB.name}` });
    dispatch({ type: 'info', message: `Lineup: ${teamB.members.map((m: any) => `${m.engineId}(${m.role})`).join(' + ')} | ELO: ${teamB.aggregateElo}` });
    dispatch({ type: 'verdict', summary: String(subB?.finalOutput ?? '(no submission)') });
    dispatch({ type: 'info', message: `Score: ${cardB?.score ?? '?'}/100` });
    
    // Winner
    if (result.winnerTeamId) {
      const winner = result.winnerTeamId === teamA.teamId ? teamA : teamB;
      const winnerCard = result.scorecards[result.winnerTeamId];
      dispatch({ type: 'header', title: `Winner: ${winner.name}` });
      dispatch({ type: 'info', message: `${winner.members.map((m: any) => `${m.engineId}(${m.role})`).join(' + ')} — Score: ${winnerCard?.score}/100` });
    } else {
      dispatch({ type: 'header', title: 'Draw — no clear winner' });
    }
    
    dispatch({ type: 'info', message: `Full debate saved: ${outputDir}` });
    
    appendMessage(ctx.chatSession, { role: 'user', content: `[team-tribunal:${mode}:${size}v${size}] ${question}`, timestamp: new Date().toISOString() });
    appendMessage(ctx.chatSession, {
      role: 'engine',
      engineId: 'team-tribunal',
      content: `Winner: ${result.winnerTeamId ? (result.winnerTeamId === teamA.teamId ? teamA.name : teamB.name) : 'Draw'}\n\nAlpha: ${String(subA?.finalOutput ?? '').slice(0, 500)}\n\nBeta: ${String(subB?.finalOutput ?? '').slice(0, 500)}`,
      timestamp: new Date().toISOString(),
    });
  } finally {
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  }
}

