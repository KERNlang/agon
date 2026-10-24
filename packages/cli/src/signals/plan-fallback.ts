/** Run-local authority: never serialized into a plan or inferred from error text. */
interface PlanFallbackRequest {
  planId: string;
  stepId: string;
  engine: string;
}

const requests = new WeakMap<AbortSignal, PlanFallbackRequest>();

export function requestPlanFallback(controller: AbortController, planId: string, stepId: string, engine: string): boolean {
  if (controller.signal.aborted || !planId || !stepId || !engine.trim()) return false;
  requests.set(controller.signal, { planId, stepId, engine: engine.trim() });
  controller.abort();
  return true;
}

export function takePlanFallback(signal: AbortSignal, planId: string): PlanFallbackRequest|undefined {
  const request = requests.get(signal);
  requests.delete(signal);
  return signal.aborted && request?.planId === planId ? request : undefined;
}

export function revokePlanFallback(signal: AbortSignal): void {
  requests.delete(signal);
}
