// Facade over ../generated/models/handler-types.js — edit the source there.
// This facade adds: the Dispatch function-type alias and `readonly` on
// HandlerContext.currentPlan on top of the generated types.

export type { OutputEvent, EngineProgress, PendingDelegation, CesarState, CesarTurnOutcome, CesarLiveMode } from '../models/handler-types.js';
export type { HandlerContext } from '../models/handler-types.js';

import type { OutputEvent } from '../models/handler-types.js';
export type Dispatch = (event: OutputEvent) => void;
