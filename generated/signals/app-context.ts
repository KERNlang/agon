// @kern-source: app-context:4
import { loadConfig } from '@agon/core';

// @kern-source: app-context:5
import type { EngineRegistry, AgonConfig, EngineAdapter, Plan, ChatSession, PersistentSession, CesarMemory } from '@agon/core';

// @kern-source: app-context:6
import type { HandlerContext } from '../../handlers/types.js';

// @kern-source: app-context:8
/**
 * Constructs the HandlerContext from React state. Called on each submit.
 */
export function buildHandlerContext(registry: EngineRegistry, adapter: EngineAdapter, activeEngines: ()=>string[], chatSession: ChatSession, askQuestion: (prompt:string)=>Promise<string>, cesarSession: PersistentSession|null, currentPlan: Plan|null, setCurrentPlan: (plan:Plan|null)=>void, setActiveAbort: (abort:AbortController|null)=>void, setCesarSession: (session:PersistentSession|null)=>void, explorationMode: boolean, setExplorationMode: (mode:boolean)=>void, neroMode: boolean, setNeroMode: (mode:boolean)=>void, cesarMemory: CesarMemory): HandlerContext {
  const config = loadConfig();
  return { registry: registry, adapter: adapter, activeEngines: activeEngines, config: config, chatSession: chatSession, currentPlan: currentPlan, setCurrentPlan: setCurrentPlan, setActiveAbort: setActiveAbort, askQuestion: askQuestion, cesarSession: cesarSession, setCesarSession: setCesarSession, explorationMode: explorationMode, setExplorationMode: setExplorationMode, neroMode: neroMode, setNeroMode: setNeroMode, cesarMemory: cesarMemory };
}

