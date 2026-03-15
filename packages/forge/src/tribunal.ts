import type {
  EngineAdapter,
  EngineDefinition,
  ForgeEvent,
} from '@agon/core';
import { EngineRegistry, buildTribunalPrompt } from '@agon/core';

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
}

/**
 * Run an adversarial tribunal — engines debate a question from different positions.
 *
 * Flow:
 * 1. Assign positions to engines (for/against/neutral)
 * 2. For each round, engines argue their position
 * 3. Each subsequent round sees previous arguments
 * 4. Final summary synthesizes the debate
 */
export async function runTribunal(opts: {
  question: string;
  engines: string[];
  rounds: number;
  registry: EngineRegistry;
  adapter: EngineAdapter;
  timeout: number;
  outputDir: string;
  onEvent?: (event: ForgeEvent) => void;
}): Promise<TribunalResult> {
  const { question, engines, rounds, registry, adapter, timeout, outputDir } = opts;

  // Assign positions based on engine count
  const positionLabels = assignPositions(engines.length);
  const positions: TribunalPosition[] = engines.map((id, i) => ({
    engineId: id,
    position: positionLabels[i],
    arguments: [],
  }));

  const allRounds: TribunalRound[] = [];

  for (let round = 1; round <= rounds; round++) {
    opts.onEvent?.({
      type: 'synthesis:start', // reuse event type
      data: { round, totalRounds: rounds },
    });

    // Build previous arguments text
    const prevArgs = round > 1
      ? positions
          .map((p) => `**${p.engineId} (${p.position}):**\n${p.arguments[p.arguments.length - 1]}`)
          .join('\n\n---\n\n')
      : undefined;

    // Dispatch all engines in parallel for this round
    const roundPromises = positions.map(async (pos) => {
      const engine = registry.get(pos.engineId);
      const prompt = buildTribunalPrompt({
        question,
        position: pos.position,
        round,
        totalRounds: rounds,
        previousArguments: prevArgs,
      });

      opts.onEvent?.({
        type: 'synthesis:critique', // reuse
        engineId: pos.engineId,
        data: { round, position: pos.position },
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

    const roundResults = await Promise.all(roundPromises);

    // Store arguments
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

  // Generate summary from the strongest engine (first available)
  const summaryEngine = registry.get(engines[0]);
  const summaryPrompt = buildSummaryPrompt(question, positions);

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
    data: { rounds: allRounds.length, engines: engines.length },
  });

  return {
    question,
    rounds: allRounds,
    positions,
    summary,
  };
}

/**
 * Assign debate positions based on participant count.
 */
function assignPositions(count: number): string[] {
  if (count === 1) return ['Analyze both sides'];
  if (count === 2) return ['Argue FOR', 'Argue AGAINST'];
  if (count === 3) return ['Argue FOR', 'Argue AGAINST', 'Play devil\'s advocate'];
  // 4+ engines
  const positions = ['Argue FOR', 'Argue AGAINST', 'Play devil\'s advocate'];
  for (let i = 3; i < count; i++) {
    positions.push(`Perspective ${i + 1}: Find unconventional angles`);
  }
  return positions;
}

/**
 * Build the summary prompt from all debate positions.
 */
function buildSummaryPrompt(question: string, positions: TribunalPosition[]): string {
  const debateText = positions
    .map((p) => {
      const allArgs = p.arguments.join('\n\n');
      return `## ${p.engineId} (${p.position})\n${allArgs}`;
    })
    .join('\n\n---\n\n');

  return `## TASK
Synthesize this debate into a clear verdict.

## QUESTION
${question}

## DEBATE
${debateText}

## INSTRUCTIONS
Provide:
1. **Verdict**: Which side has the stronger argument and why
2. **Key insights**: 2-3 non-obvious points that emerged
3. **Recommendation**: What should the user actually do?

Be decisive. Don't hedge with "it depends" — pick a side and explain why.`;
}

/**
 * Fallback summary if the synthesis engine fails.
 */
function buildFallbackSummary(positions: TribunalPosition[]): string {
  return positions
    .map((p) => `**${p.engineId} (${p.position})**: ${p.arguments[p.arguments.length - 1]?.slice(0, 200) ?? '(no response)'}...`)
    .join('\n\n');
}
