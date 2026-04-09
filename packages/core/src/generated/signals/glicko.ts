// @kern-source: glicko:5
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

// @kern-source: glicko:6
import { dirname } from 'node:path';

// @kern-source: glicko:7
import type { GlickoRating, RatingRecord, EngineMeta, TaskClass } from '../models/types.js';

// @kern-source: glicko:8
import { RATINGS_PATH } from './config.js';

// @kern-source: glicko:10
export const GLICKO_SCALE: number = 173.7178;

// @kern-source: glicko:13
export const DEFAULT_MU: number = 1500;

// @kern-source: glicko:16
export const DEFAULT_PHI: number = 350;

// @kern-source: glicko:19
export const DEFAULT_SIGMA: number = 0.06;

// @kern-source: glicko:22
export const TAU: number = 0.5;

// @kern-source: glicko:26
export const CONVERGENCE_TOLERANCE: number = 0.000001;

// @kern-source: glicko:29
export function defaultGlickoRating(): GlickoRating {
  return {
    mu: DEFAULT_MU,
    phi: DEFAULT_PHI,
    sigma: DEFAULT_SIGMA,
    wins: 0,
    losses: 0,
    lastActive: new Date().toISOString(),
  };
}

// @kern-source: glicko:41
export function defaultEngineMeta(): EngineMeta {
  const now = new Date().toISOString();
  return {
    firstSeen: now,
    lastActive: now,
    matchCount: 0,
    derivedFrom: null,
    versions: [],
  };
}

// @kern-source: glicko:53
export function loadRatings(): RatingRecord {
  try {
    return JSON.parse(readFileSync(RATINGS_PATH, 'utf-8')) as RatingRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] failed to load ratings: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {
      global: {},
      byMode: { forge: {}, brainstorm: {}, tribunal: {} },
      byTaskClass: {},
      engineMeta: {},
      lastUpdated: new Date().toISOString(),
    };
  }
}

// @kern-source: glicko:71
export function saveRatings(record: RatingRecord): void {
  mkdirSync(dirname(RATINGS_PATH), { recursive: true });
  record.lastUpdated = new Date().toISOString();
  const tmpPath = RATINGS_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(record, null, 2) + '\n');
  renameSync(tmpPath, RATINGS_PATH);
}

// @kern-source: glicko:80
export function getRatings(): RatingRecord {
  return loadRatings();
}

// @kern-source: glicko:86
export function getEngineGlickoRating(engineId: string, mode?: string): GlickoRating {
  const record = loadRatings();
  if (mode && record.byMode[mode as keyof typeof record.byMode]) {
    return record.byMode[mode as keyof typeof record.byMode][engineId] ?? defaultGlickoRating();
  }
  return record.global[engineId] ?? defaultGlickoRating();
}

// @kern-source: glicko:96
export function glickoG(phi: number): number {
  return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
}

// @kern-source: glicko:102
export function glickoE(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-glickoG(phiJ) * (mu - muJ)));
}

// @kern-source: glicko:108
export function updateGlicko(winnerId: string, loserId: string, taskClass: TaskClass, mode: 'forge'|'brainstorm'|'tribunal'): {winnerMu:number, loserMu:number} {
  const record = loadRatings();
  const now = new Date().toISOString();
  
  // Ensure all scopes exist
  record.byMode[mode] ??= {};
  record.byTaskClass[taskClass] ??= {};
  record.engineMeta[winnerId] ??= defaultEngineMeta();
  record.engineMeta[loserId] ??= defaultEngineMeta();
  
  const scopes: Array<Record<string, GlickoRating>> = [
    record.global,
    record.byMode[mode],
    record.byTaskClass[taskClass],
  ];
  
  for (const scope of scopes) {
    scope[winnerId] ??= defaultGlickoRating();
    scope[loserId] ??= defaultGlickoRating();
  
    const w = scope[winnerId];
    const l = scope[loserId];
  
    // Convert to Glicko-2 internal scale
    const muW = (w.mu - DEFAULT_MU) / GLICKO_SCALE;
    const phiW = w.phi / GLICKO_SCALE;
    const muL = (l.mu - DEFAULT_MU) / GLICKO_SCALE;
    const phiL = l.phi / GLICKO_SCALE;
  
    // Winner update (score = 1)
    const gL = glickoG(phiL);
    const eW = glickoE(muW, muL, phiL);
    const vW = 1 / (gL * gL * eW * (1 - eW));
    const deltaW = vW * gL * (1 - eW);
    const sigmaW = computeNewSigma(w.sigma, phiW, vW, deltaW);
    const phiStarW = Math.sqrt(phiW * phiW + sigmaW * sigmaW);
    const phiNewW = 1 / Math.sqrt(1 / (phiStarW * phiStarW) + 1 / vW);
    const muNewW = muW + phiNewW * phiNewW * gL * (1 - eW);
  
    // Loser update (score = 0)
    const gW = glickoG(phiW);
    const eL = glickoE(muL, muW, phiW);
    const vL = 1 / (gW * gW * eL * (1 - eL));
    const deltaL = vL * gW * (0 - eL);
    const sigmaL = computeNewSigma(l.sigma, phiL, vL, deltaL);
    const phiStarL = Math.sqrt(phiL * phiL + sigmaL * sigmaL);
    const phiNewL = 1 / Math.sqrt(1 / (phiStarL * phiStarL) + 1 / vL);
    const muNewL = muL + phiNewL * phiNewL * gW * (0 - eL);
  
    // Convert back to display scale
    w.mu = Math.round(muNewW * GLICKO_SCALE + DEFAULT_MU);
    w.phi = Math.round(phiNewW * GLICKO_SCALE * 10) / 10;
    w.sigma = sigmaW;
    w.wins++;
    w.lastActive = now;
  
    l.mu = Math.round(muNewL * GLICKO_SCALE + DEFAULT_MU);
    l.phi = Math.round(phiNewL * GLICKO_SCALE * 10) / 10;
    l.sigma = sigmaL;
    l.losses++;
    l.lastActive = now;
  }
  
  // Update meta
  record.engineMeta[winnerId].lastActive = now;
  record.engineMeta[winnerId].matchCount++;
  record.engineMeta[loserId].lastActive = now;
  record.engineMeta[loserId].matchCount++;
  
  saveRatings(record);
  return { winnerMu: record.global[winnerId].mu, loserMu: record.global[loserId].mu };
}

// @kern-source: glicko:183
export function computeNewSigma(sigma: number, phi: number, v: number, delta: number): number {
  const a = Math.log(sigma * sigma);
  const tau2 = TAU * TAU;
  
  function f(x: number): number {
    const ex = Math.exp(x);
    const phi2 = phi * phi;
    const num1 = ex * (delta * delta - phi2 - v - ex);
    const den1 = 2 * (phi2 + v + ex) * (phi2 + v + ex);
    return num1 / den1 - (x - a) / tau2;
  }
  
  // Set initial bounds
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  
  // Illinois algorithm to find root
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > CONVERGENCE_TOLERANCE) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

// @kern-source: glicko:226
export function updateGlickoRanked(ranked: Array<{engineId:string,score:number}>, taskClass: TaskClass, mode: 'forge'|'brainstorm'|'tribunal'): void {
  if (ranked.length < 2) return;
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      if (ranked[i].score === ranked[j].score) continue;
      updateGlicko(ranked[i].engineId, ranked[j].engineId, taskClass, mode);
    }
  }
}

// @kern-source: glicko:238
export function advisorScore(engineId: string, mode: 'forge'|'brainstorm'|'tribunal'): number {
  const rating = getEngineGlickoRating(engineId, mode);
  // Apply inactivity: increase phi if engine hasn't competed recently
  const daysSinceActive = (Date.now() - new Date(rating.lastActive).getTime()) / 86400000;
  let phi = rating.phi;
  if (daysSinceActive > 14) {
    // Glicko-2 standard: phi grows with inactivity, capped at initial value
    phi = Math.min(Math.sqrt(phi * phi + rating.sigma * rating.sigma * daysSinceActive), DEFAULT_PHI);
  }
  return Math.round(rating.mu - 2 * phi);
}

