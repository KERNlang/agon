import type { OutputEvent, EngineProgress } from '../handlers/types.js';

import { parseMarkdownBlocks, cleanEngineOutput } from '../markdown.js';

import { codeBlockBuffer } from '../code-buffer.js';

import { loadConfig, configSet } from '@agon/core';

export interface OutputState {
  liveSpinner: {message:string,color?:number,engineId?:string}|null;
  liveProgress: EngineProgress[]|null;
  streamingText: {engineId:string,content:string}|null;
}

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
}

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
    case 'spinner-update':
      actions.setLiveSpinner((prev: any) => prev ? { ...prev, message: event.message } : null);
      return;
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
        if (cleaned.trim()) {
          const segments = parseMarkdownBlocks(cleaned);
          codeBlockBuffer.recordFromSegments(segments);
          actions.addBlock({ type: 'engine-block', engineId: st.engineId, color, content: st.content } as any);
          if (mode === 'chat' && chatStartTime > 0) {
            actions.addBlock({ type: 'response-meta', engineId: st.engineId, elapsed: Date.now() - chatStartTime } as any);
          }
        }
        actions.setStreamingText(null);
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
      actions.setQuestionState({ prompt: (event as any).prompt, resolve: (event as any).resolve });
      return;
    case 'permission-ask': {
      // Show the permission block visually, then ask Y/N/A
      actions.addBlock(event);
      const permResolve = (event as any).resolve as (approved: boolean) => void;
      const permCommand = (event as any).command as string;
      actions.setQuestionState({
        prompt: 'Proceed? (y)es / (n)o / (a)lways allow',
        resolve: (answer: string) => {
          const lower = answer.toLowerCase().trim();
          if (lower === 'a' || lower === 'always') {
            // Save to settings.json so it persists
            const cfg = loadConfig();
            const allowed = (cfg as any).allowedCommands ?? [];
            const base = permCommand.trim().split(/\s+/)[0];
            if (base && !allowed.includes(base)) {
              allowed.push(base);
              configSet('allowedCommands' as any, allowed);
            }
            permResolve(true);
            actions.addBlock({ type: 'success', message: `Always allowed: ${base}` } as any);
          } else if (lower.startsWith('y')) {
            permResolve(true);
            actions.addBlock({ type: 'info', message: 'Approved' } as any);
          } else {
            permResolve(false);
            actions.addBlock({ type: 'warning', message: 'Denied' } as any);
          }
        },
      });
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

