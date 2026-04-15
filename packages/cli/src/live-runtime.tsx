import React, { useMemo, useRef, useSyncExternalStore } from 'react';
import { Box, Text } from 'ink';

import type { EngineProgress } from './handlers/types.js';
import type { AgentProgressSnapshot, StreamingEntry } from './generated/signals/output.js';
import { StreamingView } from './generated/surfaces/app-views.js';
import { AgentProgressView } from './generated/surfaces/agent.js';
import { CesarStatusStrip, SpinnerBlock } from './components.js';
import { cleanEngineOutput } from './generated/blocks/markdown.js';
import { icons } from './generated/signals/icons.js';

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

function subscribeLiveRuntime(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useLiveRuntimeField<T>(selector: (state: LiveRuntimeState) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const lastValueRef = useRef(selector(liveRuntimeState));

  return useSyncExternalStore(
    subscribeLiveRuntime,
    () => {
      const nextValue = selectorRef.current(liveRuntimeState);
      if (Object.is(nextValue, lastValueRef.current)) return lastValueRef.current;
      lastValueRef.current = nextValue;
      return nextValue;
    },
    () => lastValueRef.current,
  );
}

function pickLatestStream(streamingText: Record<string, StreamingEntry>): StreamingEntry | null {
  const entries = Object.values(streamingText);
  if (entries.length === 0) return null;

  let latest: StreamingEntry | null = null;
  for (const entry of entries) {
    if (!latest || entry.startedAt > latest.startedAt) latest = entry;
  }

  return latest;
}

function pickStreamSnippet(streamingText: Record<string, StreamingEntry>): { engineId: string; line: string } | null {
  const latest = pickLatestStream(streamingText);
  if (!latest || !latest.content) return null;

  const cleaned = cleanEngineOutput(latest.content);
  const lines = cleaned.split('\n').filter((line) => line.trim());
  if (lines.length === 0) return null;

  return {
    engineId: latest.engineId,
    line: lines[lines.length - 1].trim(),
  };
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

export function LiveTranscriptPane({ mode }: { mode: string }) {
  const streamingText = useLiveRuntimeField((state) => state.streamingText);
  const liveProgress = useLiveRuntimeField((state) => state.liveProgress);
  const agentProgress = useLiveRuntimeField((state) => state.agentProgress);

  const activeStream = useMemo(() => pickLatestStream(streamingText), [streamingText]);
  const snapshots = useMemo(() => Object.values(agentProgress), [agentProgress]);

  return (
    <>
      <StreamingView
        streamingText={activeStream ? { engineId: activeStream.engineId, content: activeStream.content } : null}
        mode={mode}
        liveProgress={liveProgress}
      />
      {snapshots.length > 0 && (
        <Box flexDirection="column">
          {snapshots.map((snapshot) => (
            <AgentProgressView
              key={snapshot.engineId}
              engineId={snapshot.engineId}
              turnIndex={snapshot.turnIndex}
              phase={snapshot.phase}
              userPrompt={snapshot.userPrompt}
              toolCalls={snapshot.toolCalls}
              lastTool={snapshot.lastTool}
              lastToolStatus={snapshot.lastToolStatus}
              tokensUsed={snapshot.tokensUsed}
              elapsedMs={snapshot.elapsedMs}
              turnsRemaining={snapshot.turnsRemaining}
              maxTurns={snapshot.maxTurns}
              tokensRemaining={snapshot.tokensRemaining}
              maxTokens={snapshot.maxTokens}
              error={snapshot.error}
            />
          ))}
        </Box>
      )}
    </>
  );
}

export function LiveTopSpinner({ mode }: { mode: string }) {
  const liveSpinner = useLiveRuntimeField((state) => state.liveSpinner);
  if (!liveSpinner || mode === 'chat') return null;
  return <SpinnerBlock message={liveSpinner.message} color={liveSpinner.color} />;
}

export function LiveInlineSpinner({ questionState }: { questionState: any }) {
  const liveSpinner = useLiveRuntimeField((state) => state.liveSpinner);
  if (!liveSpinner) return null;

  return (
    <Box paddingLeft={1}>
      <Text color={questionState && questionState.choices ? '#ef4444' : '#fbbf24'}>
        {questionState && questionState.choices
          ? `${icons().warning} PERMISSION REQUIRED — respond below`
          : liveSpinner.message}
      </Text>
    </Box>
  );
}

export function LiveStatusRegion(props: {
  cesarId: string;
  isActive: boolean;
  planModeQueued?: boolean;
  activePlanState?: string | null;
}) {
  const confidence = useLiveRuntimeField((state) => state.cesarConfidence);
  const liveSpinner = useLiveRuntimeField((state) => state.liveSpinner);
  const liveProgress = useLiveRuntimeField((state) => state.liveProgress);
  const streamingText = useLiveRuntimeField((state) => state.streamingText);
  const chatStartTime = useLiveRuntimeField((state) => state.chatStartTime);

  const streamSnippet = useMemo(() => pickStreamSnippet(streamingText), [streamingText]);

  return (
    <CesarStatusStrip
      cesarId={props.cesarId}
      confidence={confidence}
      spinner={liveSpinner}
      engines={liveProgress}
      startTime={chatStartTime}
      streamSnippet={streamSnippet}
      isActive={props.isActive}
      planModeQueued={props.planModeQueued}
      activePlanState={props.activePlanState ?? null}
    />
  );
}
