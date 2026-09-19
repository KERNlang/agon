/**
 * S4 compatibility adapter. The judgment algorithm is owned by
 * @kernlang/agon-support-judge; this file binds it to the current CLI UI,
 * Cesar session, and telemetry implementations.
 */
import {
  cesarConvergeForge as modularConvergeForge,
  cesarJudgeForge as modularJudgeForge,
  cesarReviewForgeOutcome as modularReviewForgeOutcome,
  parseForgeJudgment as modularParseForgeJudgment,
} from '@kernlang/agon-support-judge';
import type { JudgeRuntime } from '@kernlang/agon-support-judge';
import type { ForgeJudgment, ForgeManifest } from '@kernlang/agon-core';
import {
  classifyTask,
  extractPatchFilePatterns,
  recordForgeJudgment,
} from '@kernlang/agon-core';

import { ENGINE_COLORS } from '../blocks/output-format.js';
import type { Dispatch, HandlerContext } from '../handlers/types.js';
import { confidenceBadge, parseConfidence } from './confidence.js';
import { ensureCesarSession } from './session.js';

const compatibilityRuntime: JudgeRuntime = Object.freeze<JudgeRuntime>({
  ensureSession: async (context) => ensureCesarSession(context as HandlerContext),
  engineColor: (engineId) => ENGINE_COLORS[engineId] ?? 124,
  parseConfidence,
  confidenceBadge,
  classifyTask: (task) => classifyTask(task),
  extractPatchFilePatterns: (patches) => extractPatchFilePatterns(patches),
  recordJudgment: (...args) => recordForgeJudgment(
    args[0],
    args[1],
    args[2],
    args[3] as ReturnType<typeof classifyTask>,
    args[4],
    args[5],
    args[6],
    args[7],
  ),
});

export function parseForgeJudgment(response: string, manifest: ForgeManifest): ForgeJudgment | null {
  return modularParseForgeJudgment(response, manifest) as ForgeJudgment | null;
}

export async function cesarReviewForgeOutcome(
  manifest: ForgeManifest,
  dispatch: Dispatch,
  context: HandlerContext,
): Promise<void> {
  return modularReviewForgeOutcome(manifest, dispatch, context, compatibilityRuntime);
}

export async function cesarJudgeForge(
  manifest: ForgeManifest,
  dispatch: Dispatch,
  context: HandlerContext,
): Promise<ForgeJudgment | null> {
  return modularJudgeForge(manifest, dispatch, context, compatibilityRuntime) as Promise<ForgeJudgment | null>;
}

export async function cesarConvergeForge(
  manifest: ForgeManifest,
  judgment: ForgeJudgment,
  dispatch: Dispatch,
  context: HandlerContext,
): Promise<string | null> {
  return modularConvergeForge(manifest, judgment, dispatch, context, compatibilityRuntime);
}
