import type { TeamSpec, TeamRoundTrace, TeamSubmission, TeamEvent } from '@kernlang/agon-kernel';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';

export interface TeamTribunalRegistry {
  get(id: string): EngineDefinition;
}

/** Execute assigned rounds. The caller validates the mode and applies its round limit. */
export async function runTeamCoopTribunal(team: TeamSpec, position: string, question: string, rounds: number, mode: string, registry: TeamTribunalRegistry, adapter: EngineAdapter, timeout: number, outputDir: string, onEvent?: (event:TeamEvent)=>void, signal?: AbortSignal): Promise<{submission:TeamSubmission, arguments:string[]}> {
  const trace: TeamRoundTrace[] = [];
  const start = Date.now();
  const allArguments: string[] = [];
  let tokenSum = 0;

  const architect = team.members.find((m) => m.role === 'architect') ?? team.members[0];
  const implementers = team.members.filter((m) => m.role === 'implementer');
  const reviewer = team.members.find((m) => m.role === 'reviewer');

  for (let round = 1; round <= rounds; round++) {
    onEvent?.({ type: 'team:round-start', data: { teamId: team.teamId, round } });

    // --- Architect frames the argument strategy ---
    onEvent?.({ type: 'team:member-dispatch', data: { teamId: team.teamId, engineId: architect.engineId, role: 'architect' } });

    const prevArgs = allArguments.length > 0
      ? `\n\n## YOUR PREVIOUS ARGUMENTS:\n${allArguments.map((a, i) => `Round ${i + 1}: ${a}`).join('\n\n')}`
      : '';

    const strategyPrompt = `## TEAM ${position.toUpperCase()}\nYou are the strategist for your team arguing the "${position}" position in a ${mode} tribunal.\n\nQuestion: ${question}${prevArgs}\n\nOutline the key points your team should make in round ${round}. Be strategic — anticipate the opposing team's arguments and prepare counterpoints.`;

    const stratResult = await adapter.dispatch({
      engine: registry.get(architect.engineId),
      prompt: strategyPrompt,
      systemPrompt: 'Return text only. Do not use tools, read files, or modify the workspace.',
      cwd: outputDir,
      mode: 'exec',
      timeout,
      outputDir,
      signal,
    });

    tokenSum += stratResult.usage?.totalTokens ?? 0;
    const strategy = stratResult.stdout.trim();
    trace.push({ round, actor: architect.engineId, role: 'architect', action: 'planned', artifactSummary: strategy.slice(0, 200), durationMs: stratResult.durationMs });

    // --- Implementers contribute supporting arguments (parallel) ---
    const supportPromises = (implementers.length > 0 ? implementers : [team.members[team.members.length > 1 ? 1 : 0]]).map(async (impl) => {
      if (impl.engineId === architect.engineId) return '';

      onEvent?.({ type: 'team:member-dispatch', data: { teamId: team.teamId, engineId: impl.engineId, role: 'implementer' } });

      const supportPrompt = `## TEAM ${position.toUpperCase()} — SUPPORTING ARGUMENT\nYou are building supporting evidence for your team's "${position}" position.\n\nQuestion: ${question}\n\n## TEAM STRATEGY (from your architect):\n${strategy}\n\nWrite a compelling supporting argument that strengthens the strategy above. Add evidence, examples, or angles the architect may have missed.`;

      const supportResult = await adapter.dispatch({
        engine: registry.get(impl.engineId),
        prompt: supportPrompt,
        systemPrompt: 'Return text only. Do not use tools, read files, or modify the workspace.',
        cwd: outputDir,
        mode: 'exec',
        timeout,
        outputDir,
        signal,
      });

      tokenSum += supportResult.usage?.totalTokens ?? 0;
      trace.push({ round, actor: impl.engineId, role: 'implementer', action: 'implemented', artifactSummary: supportResult.stdout.trim().slice(0, 200), durationMs: supportResult.durationMs });

      onEvent?.({ type: 'team:member-done', data: { teamId: team.teamId, engineId: impl.engineId } });
      return supportResult.stdout.trim();
    });

    const supports = (await Promise.all(supportPromises)).filter((s) => s.length > 0);

    // --- Reviewer (or architect in 2v2) synthesizes final team argument ---
    const synthesizer = reviewer ?? architect;
    onEvent?.({ type: 'team:member-dispatch', data: { teamId: team.teamId, engineId: synthesizer.engineId, role: synthesizer === reviewer ? 'reviewer' : 'architect' } });

    const synthPrompt = `## TEAM ${position.toUpperCase()} — FINAL ARGUMENT FOR ROUND ${round}\nCombine the following into ONE strong, coherent argument for the "${position}" position.\n\nQuestion: ${question}\n\n## ARCHITECT'S STRATEGY:\n${strategy}\n\n${supports.length > 0 ? `## SUPPORTING ARGUMENTS:\n${supports.join('\n\n---\n\n')}` : ''}\n\nWrite the final unified team argument. Make it compelling, well-structured, and address likely counterarguments.`;

    const synthResult = await adapter.dispatch({
      engine: registry.get(synthesizer.engineId),
      prompt: synthPrompt,
      systemPrompt: 'Return text only. Do not use tools, read files, or modify the workspace.',
      cwd: outputDir,
      mode: 'exec',
      timeout,
      outputDir,
      signal,
    });

    tokenSum += synthResult.usage?.totalTokens ?? 0;
    const finalArg = synthResult.stdout.trim();
    allArguments.push(finalArg);

    trace.push({ round, actor: synthesizer.engineId, role: synthesizer === reviewer ? 'reviewer' : 'architect', action: 'finalized', artifactSummary: finalArg.slice(0, 200), durationMs: synthResult.durationMs });

    onEvent?.({ type: 'team:round-done', data: { teamId: team.teamId, round } });
  }

  return {
    submission: {
      teamId: team.teamId,
      finalOutput: allArguments[allArguments.length - 1],
      trace,
      totalTokens: tokenSum,
      wallClockMs: Date.now() - start,
      collaborationLift: 0,
    },
    arguments: allArguments,
  };
}
