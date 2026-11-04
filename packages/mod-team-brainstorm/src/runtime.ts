import { randomUUID } from 'node:crypto';
import { createSidechainLogger, currentInvocationOwnerAvailable } from '@kernlang/agon-kernel';
import type { TeamSpec, TeamComposeMode, TeamRoundTrace, TeamSubmission, TeamScoreCard, TeamMatchResult } from '@kernlang/agon-kernel';
import type { EngineAdapter, EngineDefinition, TaskClass } from '@kernlang/agon-support-engine-runtime';
import { composeRankedTeams, makeFormat } from '@kernlang/agon-support-panel';
import { createBrainstormScoring } from '@kernlang/agon-mod-brainstorm';
import type { BrainstormDraft, BrainstormRatingHistory } from '@kernlang/agon-mod-brainstorm';

export interface TeamBrainstormEvent {
  type: string;
  engineId?: string;
  data?: Record<string, unknown>;
}

export interface TeamBrainstormRegistry {
  get(id: string): EngineDefinition;
  isAvailable(engine: EngineDefinition): boolean;
}

export interface TeamBrainstormConfig {
  cesarEngine: string;
  ratingsEnabled: boolean;
}

/** Host effects only. Team composition, scoring and dispatch policy stay in this mod. */
export interface TeamBrainstormEffects<Registry extends TeamBrainstormRegistry, Config extends TeamBrainstormConfig> {
  loadConfig(cwd: string): Config;
  partitionRoster(registry: Registry, requested: string[] | null, config: Config): { active: string[]; removed: string[] };
  classifyTask(question: string): TaskClass;
  loadConfidenceFloor(taskClass: TaskClass): ((engineId: string) => number) | undefined;
  readRatings(): BrainstormRatingHistory;
  updateTeamElo(result: TeamMatchResult, k: number): void;
  buildKernDraftPrompt(input: { question: string; context?: string; mode: 'brainstorm' }): string;
  parseKernDraft(raw: string): BrainstormDraft | null | undefined;
}

export interface TeamBrainstormOptions<Registry extends TeamBrainstormRegistry = TeamBrainstormRegistry> {
  question: string;
  context?: string;
  membersPerSide: number;
  composeMode?: TeamComposeMode;
  explicitTeams?: [string[],string[]];
  engines?: string[];
  registry: Registry;
  adapter: EngineAdapter;
  timeout: number;
  outputDir: string;
  signal?: AbortSignal;
  onEvent?: (event:TeamBrainstormEvent)=>void;
}

export function createTeamBrainstormRuntime<Registry extends TeamBrainstormRegistry, Config extends TeamBrainstormConfig>(
  effects: TeamBrainstormEffects<Registry, Config>,
) {
  const { loadConfig, classifyTask, updateTeamElo, buildKernDraftPrompt, parseKernDraft } = effects;
  const ratingsAvailable = () => currentInvocationOwnerAvailable('agon.ratings') !== false;
  const { qualityScore } = createBrainstormScoring(() => ratingsAvailable()
    ? effects.readRatings() : { global: {}, byMode: { brainstorm: {} } });

  async function runTeamCoopBrainstorm(team: TeamSpec, question: string, context: string|undefined, registry: Registry, adapter: EngineAdapter, timeout: number, outputDir: string, onEvent?: (event:TeamBrainstormEvent)=>void, signal?: AbortSignal): Promise<{submission:TeamSubmission, proposal:string, score:number}> {
    const trace: TeamRoundTrace[] = [];
    const start = Date.now();
    let tokenSum = 0;

    const architect = team.members.find((m) => m.role === 'architect') ?? team.members[0];

    // --- Phase 1: All members draft independently (parallel) ---
    onEvent?.({ type: 'team:round-start', data: { teamId: team.teamId, round: 1 } });

    const draftPrompt = buildKernDraftPrompt({
      question,
      context,
      mode: 'brainstorm',
    });

    const draftPromises = team.members.map(async (m) => {
      onEvent?.({ type: 'team:member-dispatch', data: { teamId: team.teamId, engineId: m.engineId, role: m.role } });

      try {
        const engine = registry.get(m.engineId);
        const result = await adapter.dispatch({
          engine,
          prompt: draftPrompt,
          systemPrompt: 'Respond directly with your brainstorm draft. Do not use tools, read files, or run commands.',
          cwd: outputDir,
          mode: 'exec',
          timeout,
          outputDir,
          signal,
        });

        tokenSum += result.usage?.totalTokens ?? 0;
        const draft = parseKernDraft(result.stdout);
        trace.push({
          round: 1,
          actor: m.engineId,
          role: m.role,
          action: 'implemented',
          artifactSummary: draft ? draft.approach.slice(0, 200) : result.stdout.slice(0, 200),
          durationMs: result.durationMs,
        });

        onEvent?.({ type: 'team:member-done', data: { teamId: team.teamId, engineId: m.engineId } });

        return {
          engineId: m.engineId,
          draft: draft ?? { approach: result.stdout.slice(0, 300), reasoning: '', tradeoffs: [], confidence: 50, keyFiles: [], steps: [] },
          raw: result.stdout,
          score: qualityScore(m.engineId, draft ?? { approach: '', reasoning: '', tradeoffs: [], confidence: 50, keyFiles: [], steps: [] }),
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.warn(`[agon] team brainstorm draft (${m.engineId}) failed: ${error}`);
        trace.push({
          round: 1,
          actor: m.engineId,
          role: m.role,
          action: 'implemented',
          artifactSummary: `failed: ${error}`.slice(0, 200),
          durationMs: 0,
        });
        onEvent?.({ type: 'engine:failed', engineId: m.engineId, data: { teamId: team.teamId, engineId: m.engineId, phase: 'team-brainstorm-draft', error } });
        return {
          engineId: m.engineId,
          draft: { approach: 'Failed to respond', reasoning: error, tradeoffs: [], confidence: 0, keyFiles: [], steps: [] },
          raw: '',
          score: 0,
        };
      }
    });

    const drafts = await Promise.all(draftPromises);
    onEvent?.({ type: 'team:round-done', data: { teamId: team.teamId, round: 1 } });

    // --- Phase 2: Architect synthesizes all team drafts ---
    onEvent?.({ type: 'team:round-start', data: { teamId: team.teamId, round: 2 } });
    onEvent?.({ type: 'team:member-dispatch', data: { teamId: team.teamId, engineId: architect.engineId, role: 'architect' } });

    const allDrafts = drafts
      .sort((a, b) => b.score - a.score)
      .map((d) => {
        const steps = d.draft.steps.map((s: string, i: number) => `  ${i + 1}. ${s}`).join('\n');
        return `## ${d.engineId} (quality: ${d.score}, confidence: ${d.draft.confidence}%)\nApproach: ${d.draft.approach}${d.draft.reasoning ? `\nReasoning: ${d.draft.reasoning}` : ''}${d.draft.tradeoffs?.length ? `\nTradeoffs: ${d.draft.tradeoffs.join('; ')}` : ''}${steps ? `\nSteps:\n${steps}` : ''}`;
      })
      .join('\n\n');

    const synthPrompt = `## TEAM SYNTHESIS — PRODUCE YOUR TEAM'S BEST PROPOSAL\nYou are the team architect. Your teammates produced these drafts. Synthesize the best parts into ONE comprehensive, superior proposal.\n\nQuestion: ${question}\n\n${allDrafts}\n\nCombine the strongest ideas from ALL drafts above. Don't just pick one — take the best parts from each. Be specific and actionable. Your team's rating depends on this proposal winning against the other team.`;

    const synthEngine = registry.get(architect.engineId);
    let proposal = '';
    let synthDurationMs = 0;
    try {
      const synthResult = await adapter.dispatch({
        engine: synthEngine,
        prompt: synthPrompt,
        systemPrompt: 'Synthesize the team proposal as plain text. Do not use tools, read files, or run commands.',
        cwd: outputDir,
        mode: 'exec',
        timeout,
        outputDir,
        signal,
      });

      tokenSum += synthResult.usage?.totalTokens ?? 0;
      proposal = synthResult.stdout.trim();
      synthDurationMs = synthResult.durationMs;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[agon] team brainstorm synthesis (${architect.engineId}) failed: ${error}`);
      proposal = allDrafts || `No proposal: synthesis failed (${error})`;
      onEvent?.({ type: 'engine:failed', engineId: architect.engineId, data: { teamId: team.teamId, engineId: architect.engineId, phase: 'team-brainstorm-synthesis', error } });
    }

    trace.push({
      round: 2,
      actor: architect.engineId,
      role: 'architect',
      action: 'finalized',
      artifactSummary: proposal.slice(0, 200),
      durationMs: synthDurationMs,
    });

    onEvent?.({ type: 'team:member-done', data: { teamId: team.teamId, engineId: architect.engineId } });
    onEvent?.({ type: 'team:round-done', data: { teamId: team.teamId, round: 2 } });

    // Score the final proposal
    const avgDraftScore = drafts.length > 0 ? drafts.reduce((s, d) => s + d.score, 0) / drafts.length : 0;
    const proposalScore = Math.min(avgDraftScore * 1.2, 100); // Synthesis should be better

    return {
      submission: {
        teamId: team.teamId,
        finalOutput: proposal,
        trace,
        totalTokens: tokenSum,
        wallClockMs: Date.now() - start,
        collaborationLift: proposalScore - (drafts.length > 0 ? Math.max(...drafts.map((d) => d.score)) : 0),
      },
      proposal,
      score: proposalScore,
    };
  }

  async function runTeamBrainstorm(options: TeamBrainstormOptions<Registry>): Promise<TeamMatchResult> {
    const config = loadConfig(process.cwd());
    const matchId = randomUUID().slice(0, 8);

    const sidechain = createSidechainLogger({
      sessionId: matchId,
      sessionType: 'team-brainstorm',
      outputDir: options.outputDir,
    });

    const __roster = effects.partitionRoster(options.registry, options.engines ?? null, config);
    if (__roster.removed.length > 0) {
      throw new Error(`Removed engine(s) cannot run: ${__roster.removed.join(', ')}. Restore with 'agon engine add <id>' (or /engines restore <id>).`);
    }
    const enabledEngines = __roster.active;
    const available = enabledEngines.filter((id: string) => {
      try {
        const engine = options.registry.get(id);
        return options.registry.isAvailable(engine);
      } catch { return false; }
    });

    // Engines can appear on both teams — minimum is 2 engines + Cesar as judge
    if (available.length < 2) {
      throw new Error(`Team brainstorm requires at least 2 available engines, only ${available.length} available`);
    }

    const taskClass = classifyTask(options.question);
    const format = makeFormat(options.membersPerSide);
    const composeMode = options.composeMode ?? 'auto-balanced';

    // Cesar is the impartial judge — exclude from competing pool
    const cesarId = config.cesarEngine;
    const competitors = available.filter((id: string) => id !== cesarId);
    if (competitors.length < 2) {
      // If Cesar is the only option or pool too small, let Cesar compete AND judge
      competitors.push(...available.filter((id: string) => !competitors.includes(id)));
    }

    const [teamA, teamB] = composeRankedTeams(
      competitors,
      options.membersPerSide,
      composeMode,
      () => ratingsAvailable() ? effects.loadConfidenceFloor(taskClass) : undefined,
      options.explicitTeams,
    );

    sidechain.log('team-brainstorm:init', undefined, {
      format: format.label,
      teamA: teamA.members.map((m) => `${m.engineId}:${m.role}`),
      teamB: teamB.members.map((m) => `${m.engineId}:${m.role}`),
    });

    options.onEvent?.({ type: 'team:compose', data: { teams: [teamA, teamB] } });

    // Run both teams in parallel
    const [resultA, resultB] = await Promise.all([
      runTeamCoopBrainstorm(teamA, options.question, options.context, options.registry, options.adapter, options.timeout, options.outputDir, options.onEvent, options.signal),
      runTeamCoopBrainstorm(teamB, options.question, options.context, options.registry, options.adapter, options.timeout, options.outputDir, options.onEvent, options.signal),
    ]);

    // --- Cesar judges when available; otherwise use the first available engine.
    const judgeId = available.includes(cesarId) ? cesarId : available[0];
    const judgeEngine = options.registry.get(judgeId);
    const judgePrompt = `## BRAINSTORM JUDGE\nYou are an impartial judge. Two teams produced competing proposals for the same question. Evaluate and declare a winner.\n\nQuestion: ${options.question}\n\n## TEAM ALPHA PROPOSAL:\n${resultA.proposal}\n\n## TEAM BETA PROPOSAL:\n${resultB.proposal}\n\nEvaluate each on: completeness (0-25), actionability (0-25), creativity (0-25), feasibility (0-25).\nYou MUST end your response with exactly these two lines:\nSCORE_ALPHA: <number 0-100>\nSCORE_BETA: <number 0-100>\nThen declare: WINNER: "ALPHA" or "BETA" or "DRAW"`;

    let judgeText = '';
    try {
      const judgeResult = await options.adapter.dispatch({
        engine: judgeEngine,
        prompt: judgePrompt,
        systemPrompt: 'Judge the proposals only. Do not use tools, read files, or run commands.',
        cwd: options.outputDir,
        mode: 'exec',
        timeout: options.timeout,
        outputDir: options.outputDir,
        signal: options.signal,
      });
      judgeText = judgeResult.stdout.trim();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[agon] team brainstorm judge (${judgeId}) failed: ${error}`);
      options.onEvent?.({ type: 'engine:failed', engineId: judgeId, data: { engineId: judgeId, phase: 'team-brainstorm-judge', error } });
    }

    let winnerTeamId: string | null = null;
    if (/WINNER.*ALPHA/i.test(judgeText)) winnerTeamId = teamA.teamId;
    else if (/WINNER.*BETA/i.test(judgeText)) winnerTeamId = teamB.teamId;

    // Parse structured scores from judge (SCORE_ALPHA: XX, SCORE_BETA: XX)
    const alphaMatch = judgeText.match(/SCORE_ALPHA\s*:\s*(\d{1,3})/i);
    const betaMatch = judgeText.match(/SCORE_BETA\s*:\s*(\d{1,3})/i);
    const rawScoreA = alphaMatch ? parseInt(alphaMatch[1], 10) : resultA.score;
    const rawScoreB = betaMatch ? parseInt(betaMatch[1], 10) : resultB.score;

    const cardA: TeamScoreCard = { teamId: teamA.teamId, score: Math.min(rawScoreA, 100), breakdown: {} };
    const cardB: TeamScoreCard = { teamId: teamB.teamId, score: Math.min(rawScoreB, 100), breakdown: {} };
    if (!winnerTeamId) {
      if (cardA.score > cardB.score) winnerTeamId = teamA.teamId;
      else if (cardB.score > cardA.score) winnerTeamId = teamB.teamId;
    }

    options.onEvent?.({ type: 'team:score', data: { teamId: teamA.teamId, score: cardA.score } });
    options.onEvent?.({ type: 'team:score', data: { teamId: teamB.teamId, score: cardB.score } });
    options.onEvent?.({ type: 'team:winner', data: { winnerTeamId } });

    const matchResult: TeamMatchResult = {
      matchId,
      mode: 'brainstorm',
      task: options.question,
      format,
      teams: [teamA, teamB],
      submissions: {
        [teamA.teamId]: resultA.submission,
        [teamB.teamId]: resultB.submission,
      },
      scorecards: { [teamA.teamId]: cardA, [teamB.teamId]: cardB },
      winnerTeamId,
      timestamp: new Date().toISOString(),
    };

    if (config.ratingsEnabled && ratingsAvailable()) {
      updateTeamElo(matchResult, 32);
    }

    sidechain.log('team-brainstorm:done', winnerTeamId ?? undefined, {
      scoreA: cardA.score,
      scoreB: cardB.score,
    });

    options.onEvent?.({ type: 'team:match-done', data: {} });

    return matchResult;
  }

  return { runTeamBrainstorm, runTeamCoopBrainstorm };
}
