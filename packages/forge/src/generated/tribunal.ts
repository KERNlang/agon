import type { EngineAdapter, EngineDefinition, ForgeEvent } from '@agon/core';

import { EngineRegistry, buildTribunalPrompt } from '@agon/core';

import type { TribunalMode, TribunalModeConfig } from './tribunal-modes.js';

import { getModeConfig, buildModePrompt, buildModeSummaryPrompt } from './tribunal-modes.js';

export interface TribunalPosition {
  engineId: string;
  position: string;
  arguments: string[];
}

export interface TribunalRound {
  round: number;
  positions: TribunalPosition[];
}

export interface TribunalResult {
  question: string;
  rounds: TribunalRound[];
  positions: TribunalPosition[];
  summary: string;
  mode?: string;
}

export function assignPositions(count: number): string[] {
  if (count === 1) return ['Analyze both sides'];
  if (count === 2) return ['Argue FOR', 'Argue AGAINST'];
  if (count === 3) return ['Argue FOR', 'Argue AGAINST', "Play devil's advocate"];
  const positions = ['Argue FOR', 'Argue AGAINST', "Play devil's advocate"];
  for (let i = 3; i < count; i++) {
    positions.push(`Perspective ${i + 1}: Find unconventional angles`);
  }
  return positions;
}

export function buildSummaryPrompt(question: string, positions: TribunalPosition[]): string {
  const debateText = positions
    .map((p) => {
      const allArgs = p.arguments.join('\n\n');
      return `## ${p.engineId} (${p.position})\n${allArgs}`;
    })
    .join('\n\n---\n\n');
  
  return `## TASK\nSynthesize this debate into a clear verdict.\n\n## QUESTION\n${question}\n\n## DEBATE\n${debateText}\n\n## INSTRUCTIONS\nProvide:\n1. **Verdict**: Which side has the stronger argument and why\n2. **Key insights**: 2-3 non-obvious points that emerged\n3. **Recommendation**: What should the user actually do?\n\nBe decisive. Don't hedge with "it depends" — pick a side and explain why.`;
}

export function buildFallbackSummary(positions: TribunalPosition[]): string {
  return positions
    .map((p) => `**${p.engineId} (${p.position})**: ${p.arguments[p.arguments.length - 1]?.slice(0, 200) ?? '(no response)'}...`)
    .join('\n\n');
}

export async function runTribunal(opts: {question:string, engines:string[], rounds:number, mode?:TribunalMode, registry:EngineRegistry, adapter:EngineAdapter, timeout:number, outputDir:string, onEvent?:(event:ForgeEvent)=>void}): Promise<TribunalResult> {
  const { question, engines, rounds, registry, adapter, timeout, outputDir } = opts;
  const mode = opts.mode ?? 'adversarial';
  const modeConfig = getModeConfig(mode, engines.length);
  
  // Assign roles from mode config
  const roles = modeConfig.roles.slice(0, engines.length);
  // Pad with generic roles if more engines than roles
  while (roles.length < engines.length) {
    roles.push(`Participant ${roles.length + 1}`);
  }
  
  const positions: TribunalPosition[] = engines.map((id: string, i: number) => ({
    engineId: id,
    position: roles[i],
    arguments: [],
  }));
  
  const effectiveRounds = Math.min(rounds, modeConfig.maxRounds);
  const allRounds: TribunalRound[] = [];
  
  for (let round = 1; round <= effectiveRounds; round++) {
    opts.onEvent?.({
      type: 'synthesis:start',
      data: { round, totalRounds: effectiveRounds, mode },
    });
  
    const prevArgs = round > 1
      ? positions
          .map((p) => `**${p.engineId} (${p.position}):**\n${p.arguments[p.arguments.length - 1]}`)
          .join('\n\n---\n\n')
      : undefined;
  
    // Build prompts using mode-aware prompt builder
    const roundPromises = positions.map(async (pos) => {
      const engine = registry.get(pos.engineId);
      const prompt = buildModePrompt({
        mode,
        role: pos.position,
        question,
        round,
        totalRounds: effectiveRounds,
        previousArguments: prevArgs,
      });
  
      opts.onEvent?.({
        type: 'synthesis:critique',
        engineId: pos.engineId,
        data: { round, position: pos.position, mode },
      });
  
      try {
        const result = await adapter.dispatch({
          engine,
          prompt,
          cwd: process.cwd(),
          mode: 'review',
          timeout,
          outputDir,
        });
        return { engineId: pos.engineId, argument: result.stdout.trim() };
      } catch {
        return { engineId: pos.engineId, argument: '(failed to respond)' };
      }
    });
  
    // Sequential protocol: wait for each in order
    let roundResults: { engineId: string; argument: string }[];
    if (modeConfig.protocol === 'sequential') {
      roundResults = [];
      for (const promise of roundPromises) {
        roundResults.push(await promise);
      }
    } else {
      roundResults = await Promise.all(roundPromises);
    }
  
    for (const result of roundResults) {
      const pos = positions.find((p) => p.engineId === result.engineId);
      if (pos) pos.arguments.push(result.argument);
    }
  
    allRounds.push({
      round,
      positions: positions.map((p) => ({
        ...p,
        arguments: [p.arguments[p.arguments.length - 1]],
      })),
    });
  }
  
  // Summary using mode-aware summary prompt
  const summaryEngine = registry.get(engines[0]);
  const summaryPrompt = buildModeSummaryPrompt({ mode, question, positions });
  
  let summary: string;
  try {
    const summaryResult = await adapter.dispatch({
      engine: summaryEngine,
      prompt: summaryPrompt,
      cwd: process.cwd(),
      mode: 'review',
      timeout,
      outputDir,
    });
    summary = summaryResult.stdout.trim();
  } catch {
    summary = buildFallbackSummary(positions);
  }
  
  opts.onEvent?.({
    type: 'forge:done',
    data: { rounds: allRounds.length, engines: engines.length, mode },
  });
  
  return { question, rounds: allRounds, positions, summary, mode };
}

