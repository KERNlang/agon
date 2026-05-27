// @kern-source: consensus:19
export interface RawFinding {
  engine: string;
  severity?: string;
  blocking?: boolean;
  confidence?: number;
  file?: string;
  lines?: string;
  problem?: string;
  minimalFix?: string;
}

// @kern-source: consensus:32
export interface EngineOutcome {
  engine: string;
  status: string;
  findings: RawFinding[];
  note?: string;
}

// @kern-source: consensus:40
export interface ConsensusFinding {
  key: string;
  engines: string[];
  maxConfidence: number;
  pairVotes: number;
  severity: string;
  tier: string;
  blocks: boolean;
  problem: string;
  minimalFix?: string;
  file?: string;
  lines?: string;
}

// @kern-source: consensus:59
export interface ConsensusReport {
  findings: ConsensusFinding[];
  verified: ConsensusFinding[];
  needsCheck: ConsensusFinding[];
  speculative: ConsensusFinding[];
  nits: ConsensusFinding[];
  blockers: ConsensusFinding[];
  engineFailures: EngineOutcome[];
  panelSize: number;
  okCount: number;
  autoBlock: boolean;
  needsJudge: boolean;
  summary: string;
}

// @kern-source: consensus:79
export const PAIR_THRESHOLD: number = 0.70;

// @kern-source: consensus:80
export const VERIFIED_THRESHOLD: number = 0.85;

// @kern-source: consensus:81
export const MEDIUM_THRESHOLD: number = 0.60;

// @kern-source: consensus:83
/**
 * Clamp an arbitrary number into [0,1].
 */
export function clampConfidence(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

// @kern-source: consensus:92
/**
 * A finding's effective confidence: its self-rated value when present and finite, else inferred from severity (blocking 0.8, important 0.6, nit/unknown 0.3). Accepts a numeric STRING too (engines routinely emit confidence:"0.72"); a non-finite or absent value falls back to the severity default.
 */
export function inferConfidence(f: RawFinding): number {
  const c: any = (f as any).confidence;
  const n = typeof c === 'number'
    ? c
    : (typeof c === 'string' && c.trim() !== '' ? Number(c) : NaN);
  if (Number.isFinite(n)) return clampConfidence(n);
  const sev = (f.severity || '').toLowerCase();
  if (f.blocking === true || sev === 'blocking') return 0.8;
  if (sev === 'important' || sev === 'major') return 0.6;
  return 0.3;
}

// @kern-source: consensus:106
/**
 * Normalize a finding's severity to 'blocking' | 'important' | 'nit'. blocking===true wins; 'major'→'important'; anything unrecognized → 'nit'.
 */
export function normSeverity(f: RawFinding): string {
  const sev = (f.severity || '').toLowerCase();
  if (f.blocking === true || sev === 'blocking') return 'blocking';
  if (sev === 'important' || sev === 'major') return 'important';
  return 'nit';
}

// @kern-source: consensus:115
/**
 * Cluster key so the same issue from different engines collapses into one finding: lowercased file + a 10-line bucket of the first line number + the first 8 normalized words of the problem. Best-effort — when engines word a bug differently it stays split, which is the SAFE direction (no accidental auto-block from a phantom pair).
 */
export function clusterKey(f: RawFinding): string {
  const file = (f.file || '').trim().toLowerCase();
  const lineStr = (f.lines == null ? '' : String(f.lines));
  const m = lineStr.match(/\d+/);
  const bucket = m ? Math.floor(parseInt(m[0], 10) / 10) : -1;
  const prob = (f.problem || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ');
  return `${file}#${bucket}#${prob}`;
}

// @kern-source: consensus:132
/**
 * Fold a panel of per-engine outcomes into one tiered, deduplicated report applying the two-signal block rule. minVerified defaults to 0.85 (solo-block), minPair to 0.70 (pair-block). Fail-closed: a panel where no engine returned a usable verdict autoBlocks.
 */
export function buildConsensus(outcomes: EngineOutcome[], minVerified?: number, minPair?: number): ConsensusReport {
  const mv = typeof minVerified === 'number' && Number.isFinite(minVerified) ? minVerified : VERIFIED_THRESHOLD;
  const mp = typeof minPair === 'number' && Number.isFinite(minPair) ? minPair : PAIR_THRESHOLD;
  
  const list = Array.isArray(outcomes) ? outcomes : [];
  const panelSize = list.length;
  const ok = list.filter((o) => o && o.status === 'ok');
  const engineFailures = list.filter((o) => o && o.status !== 'ok');
  const okCount = ok.length;
  
  // Working cluster carries internal accumulators we strip before returning.
  type Work = {
    key: string;
    engines: Set<string>;
    maxConfidence: number;     // any severity, for display
    blockingMaxConf: number;   // confidence among severity==='blocking' only → drives solo-block
    sigConf: Map<string, number>; // per engine: max conf among its blocking|important findings → drives pair-block
    severity: string;          // worst across the cluster
    problem: string;
    minimalFix?: string;
    file?: string;
    lines?: string;
  };
  const sevRank = (s: string): number => (s === 'blocking' ? 2 : s === 'important' ? 1 : 0);
  const clusters = new Map<string, Work>();
  
  for (const o of ok) {
    for (const f of (o.findings || [])) {
      const key = clusterKey(f);
      const conf = inferConfidence(f);
      const sev = normSeverity(f);
      let c = clusters.get(key);
      if (!c) {
        c = {
          key,
          engines: new Set<string>(),
          maxConfidence: 0,
          blockingMaxConf: 0,
          sigConf: new Map<string, number>(),
          severity: 'nit',
          problem: f.problem || '',
          minimalFix: f.minimalFix,
          file: f.file,
          lines: f.lines,
        };
        clusters.set(key, c);
      }
      c.engines.add(o.engine);
      if (conf > c.maxConfidence) c.maxConfidence = conf;
      if (sevRank(sev) > sevRank(c.severity)) c.severity = sev;
      if (sev === 'blocking' && conf > c.blockingMaxConf) c.blockingMaxConf = conf;
      if (sev === 'blocking' || sev === 'important') {
        c.sigConf.set(o.engine, Math.max(c.sigConf.get(o.engine) ?? 0, conf));
      }
      // Keep the first informative copy of each human-facing field.
      if (!c.problem && f.problem) c.problem = f.problem;
      if (!c.minimalFix && f.minimalFix) c.minimalFix = f.minimalFix;
      if (!c.file && f.file) c.file = f.file;
      if (!c.lines && f.lines) c.lines = f.lines;
    }
  }
  
  const findings: ConsensusFinding[] = [];
  for (const c of clusters.values()) {
    const pairVotes = Array.from(c.sigConf.values()).filter((v) => v >= mp).length;
    const isNit = c.severity === 'nit';
    // Anchor quality guards pair-block: two engines only count as agreeing on
    // the SAME issue when the cluster is concrete enough to trust the match —
    // a real file+line, or a problem specific enough to be more than a few
    // generic words. Without it, sparse low-information findings (empty
    // file/lines/problem → key '#-1#') from different engines would collapse
    // into one cluster and fake a pair-block. A weak cluster can still solo-
    // block (one engine's deliberate >=0.85 blocking call) and still surfaces
    // for the judge — it just can't auto-block on phantom cross-engine agreement.
    const probWords = (c.problem || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).length;
    const hasAnchor = (!!(c.file && String(c.file).trim()) && /\d/.test(String(c.lines || ''))) || probWords >= 3;
    const soloBlock = c.severity === 'blocking' && c.blockingMaxConf >= mv;
    const pairBlock = (c.severity === 'blocking' || c.severity === 'important') && pairVotes >= 2 && hasAnchor;
    const blocks = !isNit && (soloBlock || pairBlock);
    const engines = Array.from(c.engines);
    let tier: string;
    if (isNit) tier = 'nit';
    else if (blocks) tier = 'verified';
    else if (c.maxConfidence >= MEDIUM_THRESHOLD) tier = 'needs-check';
    else if (engines.length >= 2) tier = 'needs-check'; // independent agreement beats a lone sub-0.60 hunch
    else tier = 'speculative';
    findings.push({
      key: c.key,
      engines,
      maxConfidence: c.maxConfidence,
      pairVotes,
      severity: c.severity,
      tier,
      blocks,
      problem: c.problem,
      minimalFix: c.minimalFix,
      file: c.file,
      lines: c.lines,
    });
  }
  
  findings.sort((a, b) => (a.blocks === b.blocks ? b.maxConfidence - a.maxConfidence : a.blocks ? -1 : 1));
  
  const verified = findings.filter((f) => f.tier === 'verified');
  const needsCheck = findings.filter((f) => f.tier === 'needs-check');
  const speculative = findings.filter((f) => f.tier === 'speculative');
  const nits = findings.filter((f) => f.tier === 'nit');
  const blockers = findings.filter((f) => f.blocks);
  
  const noVerdict = panelSize > 0 && okCount === 0;
  const autoBlock = blockers.length > 0 || noVerdict;
  const needsJudge = !autoBlock && needsCheck.length > 0;
  
  const failNote = engineFailures.length
    ? `, ${engineFailures.length} failed (${engineFailures.map((f) => `${f.engine}:${f.status}`).join(', ')})`
    : '';
  const summary = noVerdict
    ? `no engine produced a verdict (${panelSize} on panel${failNote}) — fail-closed block`
    : `${okCount}/${panelSize} engines reviewed${failNote} · ${verified.length} verified, ${needsCheck.length} needs-check, ${speculative.length} speculative, ${nits.length} nit`;
  
  return {
    findings,
    verified,
    needsCheck,
    speculative,
    nits,
    blockers,
    engineFailures,
    panelSize,
    okCount,
    autoBlock,
    needsJudge,
    summary,
  };
}

