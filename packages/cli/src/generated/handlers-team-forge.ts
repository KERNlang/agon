import { join } from 'node:path';

import { mkdirSync } from 'node:fs';

import { ensureAgonHome, RUNS_DIR, scanProjectContext, tracker, appendMessage, resolveWorkingDir, loadConfig } from '@agon/core';

import { runTeamForge } from '@agon/forge';

import type { Dispatch, HandlerContext } from '../handlers/types.js';

export async function handleTeamForge(task: string, fitnessCmd: string|null, dispatch: Dispatch, ctx: HandlerContext, membersPerSide?: number): Promise<void> {
  const teamAbort = new AbortController();
  try {
    ensureAgonHome();
    
    if (!task) {
      dispatch({ type: 'warning', message: 'Usage: /team-forge [2v2|3v3] <task> test with <cmd>' });
      return;
    }
    if (!fitnessCmd) {
      dispatch({ type: 'warning', message: 'Team forge needs a fitness command. Usage: /team-forge <task> test with <cmd>' });
      return;
    }
    
    const active = ctx.registry.availableIds();
    if (active.length < 2) {
      dispatch({ type: 'error', message: `Team forge needs at least 2 engines. Only found: ${active.join(', ') || 'none'}` });
      return;
    }
    
    const size = membersPerSide ?? 2;
    const forgeDir = join(RUNS_DIR, `team-forge-${Date.now()}`);
    mkdirSync(forgeDir, { recursive: true });
    
    const config = loadConfig(resolveWorkingDir());
    const cwd = resolveWorkingDir();
    const projectCtx = scanProjectContext(cwd, config.projectContext || undefined, config.contextFormat);
    
    dispatch({ type: 'header', title: `Team Forge ${size}v${size}: ${task}` });
    dispatch({ type: 'info', message: `Engines: ${active.join(', ')}` });
    dispatch({ type: 'info', message: `Fitness: ${fitnessCmd}` });
    
    dispatch({ type: 'spinner-start', message: `Composing teams and building...` });
    
    ctx.setActiveAbort(teamAbort);
    
    let result: any;
    try {
      result = await runTeamForge({
        task,
        fitnessCmd,
        cwd,
        forgeDir,
        context: projectCtx || undefined,
        membersPerSide: size,
        engines: active,
        signal: teamAbort.signal,
      }, ctx.registry, ctx.adapter, (event: any) => {
        if (teamAbort.signal.aborted) return;
        if (event.type === 'team:compose' && event.data?.teams) {
          const [tA, tB] = event.data.teams;
          dispatch({ type: 'info', message: `Team Alpha: ${tA.members.map((m: any) => `${m.engineId}(${m.role})`).join(' + ')}` });
          dispatch({ type: 'info', message: `Team Beta: ${tB.members.map((m: any) => `${m.engineId}(${m.role})`).join(' + ')}` });
        }
        if (event.type === 'team:member-dispatch' && event.data) {
          dispatch({ type: 'spinner-update', message: `${String(event.data.engineId)} (${String(event.data.role)}) working...` });
        }
        if (event.type === 'team:score' && event.data) {
          dispatch({ type: 'info', message: `Team scored: ${String(event.data.score)}` });
        }
      });
    } catch (err) {
      dispatch({ type: 'spinner-stop' });
      throw err;
    }
    
    if (teamAbort.signal.aborted) {
      dispatch({ type: 'spinner-stop' });
      return;
    }
    
    dispatch({ type: 'spinner-stop', message: 'Team forge complete' });
    
    const [teamA, teamB] = result.teams;
    const cardA = result.scorecards[teamA.teamId];
    const cardB = result.scorecards[teamB.teamId];
    
    dispatch({ type: 'header', title: `Team Alpha — ${teamA.name}` });
    dispatch({ type: 'info', message: `${teamA.members.map((m: any) => `${m.engineId}(${m.role})`).join(' + ')} | Score: ${cardA?.score ?? '?'}` });
    
    dispatch({ type: 'header', title: `Team Beta — ${teamB.name}` });
    dispatch({ type: 'info', message: `${teamB.members.map((m: any) => `${m.engineId}(${m.role})`).join(' + ')} | Score: ${cardB?.score ?? '?'}` });
    
    if (result.winnerTeamId) {
      const winner = result.winnerTeamId === teamA.teamId ? teamA : teamB;
      const winnerCard = result.scorecards[result.winnerTeamId];
      dispatch({ type: 'header', title: `Winner: ${winner.name} — Score: ${winnerCard?.score}` });
      dispatch({ type: 'info', message: `Apply winning patch: /apply` });
    } else {
      dispatch({ type: 'header', title: 'Draw — no clear winner' });
    }
    
    dispatch({ type: 'info', message: `Full results saved: ${forgeDir}` });
    
    appendMessage(ctx.chatSession, { role: 'user', content: `[team-forge:${size}v${size}] ${task}`, timestamp: new Date().toISOString() });
    appendMessage(ctx.chatSession, {
      role: 'engine', engineId: 'team-forge',
      content: `Winner: ${result.winnerTeamId ? (result.winnerTeamId === teamA.teamId ? teamA.name : teamB.name) : 'Draw'} | Alpha: ${cardA?.score} | Beta: ${cardB?.score}`,
      timestamp: new Date().toISOString(),
    });
  } finally {
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  }
}

