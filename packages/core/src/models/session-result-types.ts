export interface BrainstormResultData {
  bids: { engineId: string; reasoning: string; approach?: string; score?: number }[];
  response: string;
  dedup?: { status: string; detail?: string };
  synthesis?: { status: string; detail?: string };
}

export interface CampfireResultData {
  rounds: { engineId: string; content: string }[];
}

export interface TribunalResultData {
  rounds: { round: number; engineId: string; position: string; argument: string }[];
  verdict: string;
  protocol?: 'parallel' | 'chained' | 'hybrid';
}

export interface ForgeResultData {
  scoreboard: { engineId: string; pass: boolean; score: number; diffLines: number; filesChanged: number; durationSec: number }[];
  winner: string | null;
  synthesis?: { pass: boolean; score: number } | undefined;
}

export interface ThinkResultData {
  strategy: string;
  thoughtCount: number;
  summary: string;
  openQuestions: string[];
}

export interface CouncilResultData {
  verdict: string;
  chairmanId: string;
  confidence: number | null;
  seats: { role: string; engineId: string }[];
}

export interface SynthesisResultData {
  winner: string | null;
  judgeReasoning: string;
  swaps: number;
}

export interface NeroResultData {
  verdict: string;
  criticId: string;
  challengeConfidence: number | null;
  challengeText: string;
}

/**
 * A code review run, recorded so the full per-engine prose lives in the Ctrl+R results pager instead of flooding the transcript inline. The transcript shows only the compact consensus; reviews[] holds each engine's complete review text for on-demand viewing.
 */
export interface ReviewResultData {
  label: string;
  consensusSummary: string;
  blocking: boolean;
  reviews: { engineId: string; status: string; reviewOutput: string }[];
}

/**
 * A keyless web-grounded research run: Agon discovers sources via the authoritative router (npm/GitHub/MDN/IETF/Stack Overflow/Wikipedia, no API key), an engine drafts a cited answer from the fetched content, and Agon verifies the citations. citationsVerified/Total drive the trust line; the full answer + per-source list live in the results pager.
 */
export interface ResearchResultData {
  intent: string;
  answer: string;
  engineId: string;
  sources: { title: string; url: string }[];
  citationsVerified: number;
  citationsTotal: number;
}

/**
 * A browser-driving turn (`/chrome` / `agon chrome`): the agentic ReAct brain answered using the user's own browser through the side panel. answer is the engine's reply; pageActivity is true when page tools actually ran (the panel was attached and acted on the page), false when no page tools ran this turn — either no panel was attached, or the brain answered in text without needing one.
 */
export interface ChromeResultData {
  task: string;
  answer: string;
  engineId: string;
  pageActivity: boolean;
}

export interface SessionResult {
  type: 'brainstorm' | 'campfire' | 'tribunal' | 'forge' | 'think' | 'council' | 'synthesis' | 'nero' | 'review' | 'research' | 'chrome';
  timestamp: string;
  question: string;
  engines: string[];
  winner: string | null;
  data: BrainstormResultData | CampfireResultData | TribunalResultData | ForgeResultData | ThinkResultData | CouncilResultData | SynthesisResultData | NeroResultData | ReviewResultData | ResearchResultData | ChromeResultData;
}
