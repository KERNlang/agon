// @kern-source: role-specialization:1
import type { TaskClass, EloRecord } from '../models/types.js';

// @kern-source: role-specialization:2
import { getElo } from '../signals/elo.js';

// @kern-source: role-specialization:3
import { buildRolePrompt } from './engine-memory.js';

// @kern-source: role-specialization:5
export interface EngineRole {
  engineId: string;
  role: string;
  confidence: number;
  specialization: string;
}

// @kern-source: role-specialization:11
export function rankByTaskClass(engineIds: string[], taskClass: TaskClass): EngineRole[] {
  const elo = getElo();
  const classRatings = elo.byTaskClass[taskClass] ?? {};
  
  const ranked = engineIds.map((id) => {
    const rating = classRatings[id];
    const global = elo.global[id];
    const classElo = rating?.rating ?? 1500;
    const globalElo = global?.rating ?? 1500;
    const wins = (rating?.wins ?? 0) + (global?.wins ?? 0);
    const losses = (rating?.losses ?? 0) + (global?.losses ?? 0);
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
  
  // Sort by class ELO first, then global
  ranked.sort((a, b) => {
    if (a.classElo !== b.classElo) return b.classElo - a.classElo;
    return b.globalElo - a.globalElo;
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

// @kern-source: role-specialization:68
export function buildSpecializedPrompt(engineId: string, taskClass: TaskClass, basePrompt: string): string {
  const rolePrompt = buildRolePrompt(engineId, taskClass);
  if (!rolePrompt) return basePrompt;
  return basePrompt + '\n' + rolePrompt;
}

// @kern-source: role-specialization:75
export function assignForgeRoles(engineIds: string[], taskClass: TaskClass): Map<string,{role:string,specialization:string}> {
  const roles = rankByTaskClass(engineIds, taskClass);
  const map = new Map<string, { role: string; specialization: string }>();
  for (const r of roles) {
    map.set(r.engineId, { role: r.role, specialization: r.specialization });
  }
  return map;
}

