import { createForgeWorkflowEffects } from '@kernlang/agon-core';
import type { EngineRegistry } from '@kernlang/agon-core';
import { createForgeWorkflow } from '@kernlang/agon-mod-forge';

/** Bind existing host effects. The physical Forge mod owns execution. */
export const {
  runForge, shellQuoteForForge, buildForgeCleanupCommand, resolveForgeSynthesisTimeout,
  resolveForgeRunTimeout, completeMissingForgeResults, summarizeNoDiffForgeResults,
  writeForgeResultBundle,
} = createForgeWorkflow<EngineRegistry>(createForgeWorkflowEffects());
