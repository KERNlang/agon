
import type { EngineProgress } from './handlers/types.js';
import type { AgentProgressSnapshot, StreamingEntry } from './generated/signals/output.js';

type LiveSpinner = { message: string; color?: number; engineId?: string } | null;

type LiveRuntimeState = {
  liveSpinner: LiveSpinner;
  liveProgress: EngineProgress[] | null;
  streamingText: Record<string, StreamingEntry>;
  agentProgress: Record<string, AgentProgressSnapshot>;
  cesarConfidence: number | null;
  chatStartTime: number;
};

const EMPTY_RUNTIME_STATE: LiveRuntimeState = {
  liveSpinner: null,
  liveProgress: null,
  streamingText: {},
  agentProgress: {},
  cesarConfidence: null,
  chatStartTime: 0,
};

let liveRuntimeState: LiveRuntimeState = EMPTY_RUNTIME_STATE;
const listeners = new Set<() => void>();

function emitLiveRuntimeChange() {
  for (const listener of listeners) listener();
}

function updateLiveRuntimeState(updater: (previous: LiveRuntimeState) => LiveRuntimeState) {
  const next = updater(liveRuntimeState);
  if (next === liveRuntimeState) return;
  liveRuntimeState = next;
  emitLiveRuntimeChange();
}





export function getLiveRuntimeState(): LiveRuntimeState {
  return liveRuntimeState;
}

export function setLiveSpinnerState(next: LiveSpinner | ((previous: LiveSpinner) => LiveSpinner)) {
  updateLiveRuntimeState((previous) => {
    const resolved = typeof next === 'function' ? (next as (previous: LiveSpinner) => LiveSpinner)(previous.liveSpinner) : next;
    if (Object.is(resolved, previous.liveSpinner)) return previous;
    return { ...previous, liveSpinner: resolved };
  });
}

export function setLiveProgressState(next: EngineProgress[] | null) {
  updateLiveRuntimeState((previous) => {
    if (Object.is(next, previous.liveProgress)) return previous;
    return { ...previous, liveProgress: next };
  });
}

export function updateStreamingTextState(
  next: Record<string, StreamingEntry> | ((previous: Record<string, StreamingEntry>) => Record<string, StreamingEntry>),
) {
  updateLiveRuntimeState((previous) => {
    const resolved = typeof next === 'function'
      ? (next as (previous: Record<string, StreamingEntry>) => Record<string, StreamingEntry>)(previous.streamingText)
      : next;
    if (Object.is(resolved, previous.streamingText)) return previous;
    return { ...previous, streamingText: resolved };
  });
}

export function updateAgentProgressState(
  next: Record<string, AgentProgressSnapshot> | ((previous: Record<string, AgentProgressSnapshot>) => Record<string, AgentProgressSnapshot>),
) {
  updateLiveRuntimeState((previous) => {
    const resolved = typeof next === 'function'
      ? (next as (previous: Record<string, AgentProgressSnapshot>) => Record<string, AgentProgressSnapshot>)(previous.agentProgress)
      : next;
    if (Object.is(resolved, previous.agentProgress)) return previous;
    return { ...previous, agentProgress: resolved };
  });
}

export function clearAgentProgressByTeamState(teamId: string) {
  updateLiveRuntimeState((previous) => {
    let changed = false;
    const next: Record<string, AgentProgressSnapshot> = {};

    for (const engineId of Object.keys(previous.agentProgress)) {
      const entry = previous.agentProgress[engineId];
      if (entry.teamId === teamId) {
        changed = true;
        continue;
      }
      next[engineId] = entry;
    }

    if (!changed) return previous;
    return { ...previous, agentProgress: next };
  });
}

export function pruneCompletedAgentProgressState(maxAgeMs: number, now = Date.now()) {
  updateLiveRuntimeState((previous) => {
    let changed = false;
    const next: Record<string, AgentProgressSnapshot> = {};

    for (const engineId of Object.keys(previous.agentProgress)) {
      const entry = previous.agentProgress[engineId];
      if (entry.completedAt && now - entry.completedAt > maxAgeMs) {
        changed = true;
        continue;
      }
      next[engineId] = entry;
    }

    if (!changed) return previous;
    return { ...previous, agentProgress: next };
  });
}

export function setCesarConfidenceState(next: number | null) {
  updateLiveRuntimeState((previous) => {
    if (Object.is(next, previous.cesarConfidence)) return previous;
    return { ...previous, cesarConfidence: next };
  });
}

export function setChatStartTimeState(next: number) {
  updateLiveRuntimeState((previous) => {
    if (Object.is(next, previous.chatStartTime)) return previous;
    return { ...previous, chatStartTime: next };
  });
}

export function resetLiveRuntimeState(options?: { preserveConfidence?: boolean }) {
  updateLiveRuntimeState((previous) => {
    const preserveConfidence = options?.preserveConfidence !== false;
    const nextConfidence = preserveConfidence ? previous.cesarConfidence : null;
    if (
      previous.liveSpinner === null &&
      previous.liveProgress === null &&
      Object.keys(previous.streamingText).length === 0 &&
      Object.keys(previous.agentProgress).length === 0 &&
      Object.is(previous.cesarConfidence, nextConfidence) &&
      previous.chatStartTime === 0
    ) {
      return previous;
    }

    return {
      liveSpinner: null,
      liveProgress: null,
      streamingText: {},
      agentProgress: {},
      cesarConfidence: nextConfidence,
      chatStartTime: 0,
    };
  });
}




