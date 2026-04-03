import { loadConfig } from '@agon/core';

import type { EngineRegistry, AgonConfig, EngineAdapter, Plan, ChatSession, PersistentSession } from '@agon/core';

import type { HandlerContext } from '../handlers/types.js';

export function buildHandlerContext(registry: EngineRegistry, adapter: EngineAdapter, activeEngines: ()=>string[], chatSession: ChatSession, askQuestion: (prompt:string)=>Promise<string>, cesarSession: PersistentSession|null, currentPlan: Plan|null, setCurrentPlan: (plan:Plan|null)=>void, setActiveAbort: (abort:AbortController|null)=>void, setCesarSession: (session:PersistentSession|null)=>void): HandlerContext {
  const config = loadConfig();
  return {
    registry,
    adapter,
    activeEngines,
    config,
    chatSession,
    currentPlan,
    setCurrentPlan,
    setActiveAbort,
    askQuestion,
    cesarSession,
    setCesarSession,
  };
}

