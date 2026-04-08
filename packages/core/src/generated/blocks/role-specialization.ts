// @kern-source: role-specialization:1
import type { TaskClass, EloRecord } from '../models/types.js';

// @kern-source: role-specialization:2
import { getElo } from '../signals/elo.js';

// @kern-source: role-specialization:3
import { getRatings, advisorScore } from '../signals/glicko.js';

// @kern-source: role-specialization:4
import { buildRolePrompt } from './engine-memory.js';

// @kern-source: role-specialization:6
export interface EngineRole {
  engineId: string;
  role: string;
  confidence: number;
  specialization: string;
}

// @kern-source: role-specialization:12
export function rankByTaskClass(engineIds: string[], taskClass: TaskClass): EngineRole[] {
  // Use Glicko-2 ratings (with ELO fallback for legacy data)
  const ratings = getRatings();
  const classRatings = ratings.byTaskClass[taskClass] ?? {};
  const globalRatings = ratings.global;
  const elo = getElo();
  
  const ranked = engineIds.map((id) => {
    const classGlicko = classRatings[id];
    const globalGlicko = globalRatings[id];
    // Prefer Glicko-2 confidence floor; fall back to old ELO
    const classElo = classGlicko
      ? Math.round(classGlicko.mu - 2 * classGlicko.phi)
      : (elo.byTaskClass[taskClass]?.[id]?.rating ?? 1500);
    const globalElo = globalGlicko
      ? Math.round(globalGlicko.mu - 2 * globalGlicko.phi)
      : (elo.global[id]?.rating ?? 1500);
    const wins = (classGlicko?.wins ?? 0) + (globalGlicko?.wins ?? 0);
    const losses = (classGlicko?.losses ?? 0) + (globalGlicko?.losses ?? 0);
    const total = wins + losses;
    const winRate = total > 0 ? wins / total : 0.5;
  
    return {
      engineId: id,
      classElo,
      globalElo,
      winRate,
      total,
    };
  });
  
  // Sort by Glicko-2 confidence floor. Shuffle ties randomly so no engine
  // is permanently favored when ratings are equal (e.g. fresh start).
  ranked.sort((a, b) => {
    if (a.classElo !== b.classElo) return b.classElo - a.classElo;
    if (a.globalElo !== b.globalElo) return b.globalElo - a.globalElo;
    return Math.random() - 0.5;
  });
  
  return ranked.map((r, i) => {
    let role: string;
    let specialization: string;
  
    if (i === 0 && r.total >= 3) {
      role = 'lead';
      specialization = `You are the top-rated engine for ${taskClass} tasks (${r.classElo} ELO, ${Math.round(r.winRate * 100)}% win rate). Lead with your best approach.`;
    } else if (i === ranked.length - 1 && r.total >= 3) {
      role = 'challenger';
      specialization = `You are the challenger. Focus on what the lead engine might miss: edge cases, error handling, performance pitfalls. Your contrarian perspective is your strength.`;
    } else if (r.total < 3) {
      role = 'newcomer';
      specialization = `You have limited history on ${taskClass} tasks. Bring a fresh perspective — don't follow conventional patterns.`;
    } else {
      role = 'specialist';
      specialization = `You have a ${Math.round(r.winRate * 100)}% win rate on ${taskClass} tasks. Focus on what you do best.`;
    }
  
    return {
      engineId: r.engineId,
      role,
      confidence: r.winRate * 100,
      specialization,
    };
  });
}

// @kern-source: role-specialization:79
export function buildSpecializedPrompt(engineId: string, taskClass: TaskClass, basePrompt: string): string {
  const rolePrompt = buildRolePrompt(engineId, taskClass);
  if (!rolePrompt) return basePrompt;
  return basePrompt + '\n' + rolePrompt;
}

// @kern-source: role-specialization:86
export function assignForgeRoles(engineIds: string[], taskClass: TaskClass): Map<string,{role:string,specialization:string}> {
  const roles = rankByTaskClass(engineIds, taskClass);
  const map = new Map<string, { role: string; specialization: string }>();
  for (const r of roles) {
    map.set(r.engineId, { role: r.role, specialization: r.specialization });
  }
  return map;
}

