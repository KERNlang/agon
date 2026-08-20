// Handler-facing view of the OutputEvent model. Adds the Dispatch
// function-type alias and `readonly` on HandlerContext.currentPlan on top of
// the shapes declared in ../models/handler-types.ts.

export type { OutputEvent, EngineProgress, PendingDelegation, CesarState, CesarTurnOutcome, CesarLiveMode } from '../models/handler-types.js';
export type { HandlerContext } from '../models/handler-types.js';

import type { OutputEvent } from '../models/handler-types.js';
export type Dispatch = (event: OutputEvent) => void;
