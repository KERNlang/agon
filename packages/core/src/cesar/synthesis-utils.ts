import type { EngineResult } from '../models/types.js';

import type { AgentTeamResult } from './agent-team.js';

import { worktreeChangedShortstat } from '../blocks/git.js';

import { determineWinner as rankCandidates } from '@kernlang/agon-support-judge';

/** Keep the legacy parameter type while sharing the comparison function. */
export const determineWinner: (
  results: Map<string, EngineResult>, spread: number,
) => ReturnType<typeof rankCandidates> = rankCandidates;


/**
 * Convert an AgentTeamResult into a Map<engineId,EngineResult> suitable for determineWinner. For taskKind='edit', fitnessPassed must be provided (pre-computed by runAgentTeam from typecheck-or-fail gate). For 'investigate', no fitness check; scoring uses message length + tool-call density.
 */
export function scoreAgentTeamResult(teamResult: AgentTeamResult, repoRoot: string, taskKind: 'edit'|'investigate', fitnessPassed?: Map<string,boolean>): Map<string,EngineResult> {
  const out = new Map<string, EngineResult>();
  for (const m of teamResult.members) {
    if (!m.stepResult || m.error) {
      // Failed members get pass=false. determineWinner filters them out.
      out.set(m.engineId, {
        engineId: m.engineId,
        pass: false,
        score: 0,
        diffLines: 0,
        filesChanged: 0,
        durationSec: 0,
        lintWarnings: 0,
        styleScore: 0,
      });
      continue;
    }

    if (taskKind === 'edit') {
      // RT-3 fix: typecheck-or-fail is the fitness gate. Members that fail
      // typecheck score pass=false regardless of diff size, so stub-and-done
      // can never beat correct work. The actual typecheck happens in
      // runAgentTeam (Phase 4) and the result is passed in via fitnessPassed.
      const passed = fitnessPassed?.get(m.engineId) ?? false;
      let diffLines = 0;
      let filesChanged = 0;
      if (m.worktreePath) {
        try {
          const stat = worktreeChangedShortstat(m.worktreePath, teamResult.baseSha);
          diffLines = stat.linesChanged;
          filesChanged = stat.filesChanged;
        } catch { /* leave at 0 */ }
      }
      // Score: completion + non-empty diff + fitness-pass bonus. Tunable later.
      const completionBonus = m.stepResult.stopReason === 'completed' ? 50 : 0;
      const diffBonus = diffLines > 0 ? 30 : 0;
      const fitnessBonus = passed ? 20 : 0;
      const score = completionBonus + diffBonus + fitnessBonus;
      out.set(m.engineId, {
        engineId: m.engineId,
        pass: passed && diffLines > 0 && m.stepResult.stopReason === 'completed',
        score,
        diffLines,
        filesChanged,
        durationSec: Math.max(1, Math.round(teamResult.durationMs / 1000)),
        lintWarnings: 0,
        styleScore: 0,
        worktreePath: m.worktreePath ?? undefined,
      });
    } else {
      // RT-9 fix: investigation tasks have no diff to score.
      // Score on message length (proxy for thoroughness) + tool-call
      // count (proxy for evidence depth) + completion.
      const responseLen = m.stepResult.response?.length ?? 0;
      const toolCalls = m.stepResult.toolCalls ?? 0;
      const completionBonus = m.stepResult.stopReason === 'completed' ? 50 : 0;
      const lengthBonus = Math.min(50, Math.floor(responseLen / 100));  // 1pt per 100 chars, cap 50
      const toolBonus = Math.min(30, toolCalls * 3);  // 3pt per tool call, cap 30
      const score = completionBonus + lengthBonus + toolBonus;
      out.set(m.engineId, {
        engineId: m.engineId,
        pass: m.stepResult.stopReason === 'completed' && responseLen > 50,
        score,
        diffLines: 0,
        filesChanged: 0,
        durationSec: Math.max(1, Math.round(teamResult.durationMs / 1000)),
        lintWarnings: 0,
        styleScore: 0,
      });
    }
  }
  return out;
}
