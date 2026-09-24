/** @deprecated S4 compatibility adapter. Import from @kernlang/agon-support-panel. */
import {
  preflightHealthFilter as supportPreflightHealthFilter,
  type PanelHealthRuntime,
} from "@kernlang/agon-support-panel";
import { loadConfig } from "@kernlang/agon-core";

const runtime: PanelHealthRuntime = Object.freeze<PanelHealthRuntime>({ loadConfig });

export function preflightHealthFilter(
  opts: Parameters<typeof supportPreflightHealthFilter>[0],
): ReturnType<typeof supportPreflightHealthFilter> {
  return supportPreflightHealthFilter({ ...opts, runtime });
}

export {
  HEALTH_CHECK_DEFAULT_PROMPT,
  HEALTH_CHECK_DISABLE_ENV,
  healthCheckEngine,
  healthCheckEngines,
  isApiBackedEngine,
} from "@kernlang/agon-support-panel";
export type {
  HealthCheckResult,
  HealthCheckSummary,
  PanelEngineRegistry,
  PanelHealthRuntime,
  PreflightHealthResult,
  PreflightSkip,
} from "@kernlang/agon-support-panel";
