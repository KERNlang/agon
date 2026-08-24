/** @deprecated S4 compatibility adapter. Import generic persistence from @kernlang/agon-support-persistence. */
import {
  deletePersistedPlan,
  listPersistedPlans,
  loadPersistedPlan,
  savePersistedPlan,
} from '@kernlang/agon-support-persistence';

import type { Plan } from '../blocks/plan.js';

export function savePlan(plan: Plan): void {
  savePersistedPlan(plan);
}

export function loadPlan(id: string): Plan | null {
  return loadPersistedPlan<Plan>(id);
}

export function listPlans(limit?: number): Plan[] {
  return listPersistedPlans<Plan>(limit);
}

export const deletePlan = deletePersistedPlan;
