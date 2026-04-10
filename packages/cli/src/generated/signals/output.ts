// @kern-source: output:5
import type { OutputEvent, EngineProgress } from '../../handlers/types.js';

// @kern-source: output:6
import { parseMarkdownBlocks, cleanEngineOutput } from '../blocks/markdown.js';

// @kern-source: output:7
import { codeBlockBuffer } from '../../code-buffer.js';

// @kern-source: output:8
import { loadConfig, configSet } from '@agon/core';

// @kern-source: output:10
export interface OutputState {
  liveSpinner: {message:string,color?:number,engineId?:string}|null;
  liveProgress: EngineProgress[]|null;
  streamingText: {engineId:string,content:string}|null;
}

// @kern-source: output:15
export interface OutputActions {
  setLiveSpinner: (val:any) => void;
  setLiveProgress: (val:EngineProgress[]|null) => void;
  setStreamingText: (val:{engineId:string,content:string}|null) => void;
  addBlock: (event:OutputEvent) => void;
  clearBlocks: () => void;
  setReviewEvent: (val:any) => void;
  setQuestionState: (val:any) => void;
  setChatStartTime: (val:number) => void;
  flushStream: () => void;
  getEngineColor: (engineId:string) => number;
  setCesarConfidence: (val:number|null) => void;
}

// @kern-source: output:29
export const _permissionQueue: Array<{tool:string,command:string,reason:string,resolve:(approved:boolean)=>void}> = [] as Array<{tool:string,command:string,reason:string,resolve:(approved:boolean)=>void}>;

// @kern-source: output:32
/**
 * Reject all queued permissions and clear the queue. Called on interrupt/cancel.
 */
export function clearPermissionQueue(): void {
  while (_permissionQueue.length > 0) {
    const entry = _permissionQueue.shift()!;
    entry.resolve(false);
  }
}

// @kern-source: output:41
/**
 * Auto-approve queued permissions whose base command is already in allowedCommands.
 */
function _drainAutoApproved(actions: OutputActions): void {
  const cfg = loadConfig();
  const allowed: string[] = (cfg as any).allowedCommands ?? [];
  if (allowed.length === 0) return;
  // Drain from the front: auto-approve entries matching the allow-list
  while (_permissionQueue.length > 0) {
    const head = _permissionQueue[0];
    const base = head.command.trim().split(/\s+/)[0];
    if (base && allowed.some((a: string) => base.toLowerCase().startsWith(a.toLowerCase()))) {
      _permissionQueue.shift();
      head.resolve(true);
    } else {
      break;
    }
  }
}

// @kern-source: output:60
function _showNextPermission(actions: OutputActions): void {
  // First drain any that are now auto-approved (e.g. after "Always")
  _drainAutoApproved(actions);
  if (_permissionQueue.length === 0) return;
  const next = _permissionQueue[0];
  actions.addBlock({ type: 'permission-ask', tool: next.tool, command: next.command, reason: next.reason, resolve: next.resolve } as any);
  const permResolve = next.resolve;
  const permCommand = next.command;
  actions.setQuestionState({
    prompt: `${next.tool}: ${permCommand.length > 60 ? permCommand.slice(0, 60) + '\u2026' : permCommand}`,
    choices: [
      { key: 'y', label: 'Yes', color: '#4ade80' },
      { key: 'n', label: 'No', color: '#ef4444' },
      { key: 'a', label: 'Always', color: '#60a5fa' },
    ],
    resolve: (answer: string) => {
      _permissionQueue.shift();
      const lower = answer.toLowerCase().trim();
      if (lower === 'a') {
        const cfg = loadConfig();
        const allowed = (cfg as any).allowedCommands ?? [];
        const base = permCommand.trim().split(/\s+/)[0];
        if (base && !allowed.includes(base)) {
          allowed.push(base);
          configSet('allowedCommands' as any, allowed);
        }
        permResolve(true);
        actions.addBlock({ type: 'success', message: `Always allowed: ${base}` } as any);
      } else if (lower === 'y') {
        permResolve(true);
      } else {
        permResolve(false);
        actions.addBlock({ type: 'warning', message: 'Denied' } as any);
      }
      // Show next queued permission (drains auto-approved first)
      if (_permissionQueue.length > 0) {
        setTimeout(() => _showNextPermission(actions), 50);
      }
    },
  });
}

// @kern-source: output:103
/**
 * Process a single OutputEvent — updates spinner, streaming, and block state.
 */
export function handleOutputEvent(event: OutputEvent, state: OutputState, actions: OutputActions, mode: string, chatStartTime: number): void {
  switch (event.type) {
    case 'spinner-start':
      actions.setChatStartTime(Date.now());
      actions.setLiveSpinner({ message: event.message, color: event.color, engineId: (event as any).engineId });
      return;
    case 'spinner-stop':
      actions.setLiveSpinner(null);
      if ((event as any).message) {
        actions.addBlock({ type: 'success', message: (event as any).message } as any);
      }
      return;
    case 'spinner-update': {
      // Throttle spinner updates to prevent jitter (200ms minimum interval)
      const now = Date.now();
      if ((handleOutputEvent as any)._lastSpinnerUpdate && now - (handleOutputEvent as any)._lastSpinnerUpdate < 200) return;
      (handleOutputEvent as any)._lastSpinnerUpdate = now;
      actions.setLiveSpinner((prev: any) => prev ? { ...prev, message: event.message } : null);
      return;
    }
    case 'progress-update':
      actions.setLiveProgress(event.engines);
      return;
    case 'progress-clear':
      actions.setLiveProgress(null);
      return;
    case 'streaming-chunk': {
      const prev = state.streamingText;
      if (prev && prev.engineId === event.engineId) {
        actions.setStreamingText({ engineId: event.engineId, content: prev.content + event.chunk });
      } else {
        actions.setStreamingText({ engineId: event.engineId, content: event.chunk });
      }
      return;
    }
    case 'streaming-end': {
      const st = state.streamingText;
      if (st) {
        const color = actions.getEngineColor(st.engineId);
        const cleaned = cleanEngineOutput(st.content);
        actions.setStreamingText(null);
        if (cleaned.trim()) {
          const segments = parseMarkdownBlocks(cleaned);
          codeBlockBuffer.recordFromSegments(segments);
          actions.addBlock({ type: 'engine-block', engineId: st.engineId, color, content: st.content } as any);
          if (mode === 'chat' && chatStartTime > 0) {
            actions.addBlock({ type: 'response-meta', engineId: st.engineId, elapsed: Date.now() - chatStartTime } as any);
          }
        }
      }
      return;
    }
    case 'clear':
      actions.clearBlocks();
      actions.setStreamingText(null);
      codeBlockBuffer.clear();
      return;
    case 'patch-review':
      actions.setReviewEvent({ winnerId: (event as any).winnerId, patchPath: (event as any).patchPath, patchContent: (event as any).patchContent });
      return;
    case 'question':
      // Don't overwrite a pending permission prompt — permission has priority
      if (_permissionQueue.length > 0) {
        // Auto-resolve the question as dismissed — permission takes precedence
        const qResolve = (event as any).resolve;
        if (qResolve) qResolve('');
        return;
      }
      actions.setQuestionState({ prompt: (event as any).prompt, resolve: (event as any).resolve, choices: (event as any).choices });
      return;
    case 'permission-ask': {
      // Queue permission requests — show one at a time to prevent overwriting
      const entry = {
        tool: (event as any).tool as string,
        command: (event as any).command as string,
        reason: (event as any).reason as string,
        resolve: (event as any).resolve as (approved: boolean) => void,
      };
      _permissionQueue.push(entry);
      // Only show if this is the first/only item (no active prompt)
      if (_permissionQueue.length === 1) {
        _showNextPermission(actions);
      }
      return;
    }
    case 'plan-proposal': {
      actions.addBlock(event);
      return;
    }
    case 'plan-execution': {
      actions.addBlock(event);
      return;
    }
    case 'confidence-update': {
      actions.setCesarConfidence((event as any).value);
      return;
    }
    default:
      // Record code blocks from engine-block events
      if (event.type === 'engine-block') {
        const cleaned = cleanEngineOutput((event as any).content);
        const segments = parseMarkdownBlocks(cleaned);
        codeBlockBuffer.recordFromSegments(segments);
      }
      // Flush any pending stream before adding non-stream events
      if (event.type === 'text' || event.type === 'engine-block' || event.type === 'separator') {
        actions.flushStream();
      }
      actions.addBlock(event);
      // Chat mode timing for engine-block
      if (mode === 'chat' && event.type === 'engine-block' && chatStartTime > 0) {
        actions.addBlock({ type: 'response-meta', engineId: (event as any).engineId, elapsed: Date.now() - chatStartTime } as any);
      }
  }
}

