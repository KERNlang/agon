/** A20-PLAN-STATE/STORE (KL-011): compatibility exports only.
 * All execution-plan state and storage behavior lives in the physical Plan mod.
 * Remove this facade after callers migrate to owner-checked Plan activation. */
export type { CesarPlan, CesarPlanStep, CesarPlanState, CesarStepState, CesarStepType, CesarStepResult } from '@kernlang/agon-mod-plan';
export {
  CESAR_STEP_TYPES, CESAR_STEP_TYPE_TABLE,
  createCesarPlan, approveCesarPlan, advanceCesarStep, cancelCesarPlan, exitCesarPlan,
  getCesarPlansDir, cesarPlanJsonPath, cesarPlanMarkdownPath,
  saveCesarPlan, loadCesarPlan, listCesarPlans,
} from '@kernlang/agon-mod-plan';
