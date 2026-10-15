import {
  createForgeCorpus, createForgeManifestStore, runSyntaxCheck, runFitness,
} from '@kernlang/agon-mod-forge';
import type { ForgeHostServices, ForgeWorkflowEffects } from '@kernlang/agon-mod-forge';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import { createSidechainLogger } from '@kernlang/agon-kernel';
import { writeVersionedResultEnvelope } from '@kernlang/agon-support-persistence';
import type { EngineRegistry } from '../signals/engine-registry.js';
import { loadConfig, RUNS_DIR, CORPUS_PATH } from '../signals/config.js';
import { seedNewEnginesFromRegistry, updateGlickoRanked } from '../signals/glicko.js';
import { tracker, estimateTokens, estimateCost } from '../signals/token-tracker.js';
import { classifyTask } from './task-classifier.js';
import { assignForgeRoles, buildSpecializedPrompt } from './role-specialization.js';
import { buildKernContextSpine } from './context-scanner.js';
import { withFileLock } from './file-lock.js';
import { validateSyntax, detectLanguageFromPath } from './syntax-validator-bridge.js';
import {
  repoRoot, stashSnapshot, worktreeCreate, worktreeRemoveBestEffort,
  worktreePruneOrphaned, worktreeDiff, diffLineCount, diffFileCount, applyPatch,
} from './git.js';

/** Bind shared effects without reading configuration or opening a provider. */
export function createForgeWorkflowEffects(): ForgeWorkflowEffects<EngineRegistry> {
  const fitness = {
    worktreeDiff, diffLineCount, diffFileCount,
    runSyntaxCheck: (path: string) => runSyntaxCheck(path, { validateSyntax, detectLanguageFromPath }),
  };
  return {
    loadConfig, repoRoot, stashSnapshot, worktreeRemoveBestEffort, worktreePruneOrphaned,
    updateGlickoRanked, classifyTask, assignForgeRoles, buildSpecializedPrompt, tracker,
    seedNewEnginesFromRegistry, buildKernContextSpine, writeVersionedResultEnvelope,
    writeManifest: createForgeManifestStore({ runsDir: RUNS_DIR, withFileLock }).writeManifest,
    addToCorpus: createForgeCorpus(CORPUS_PATH).addToCorpus,
    stages: { repoRoot, worktreeCreate, worktreeRemoveBestEffort, estimateTokens, estimateCost, fitness },
    synthesis: { worktreeCreate, worktreeRemoveBestEffort, applyPatch, fitness },
    gauntlet: {
      repoRoot, worktreeDiff, worktreeCreate, worktreeRemoveBestEffort, createSidechainLogger,
      runFitness: options => runFitness(options, fitness),
    },
  };
}

/** Open invocation-scoped transport. Workflow policy stays in the Forge mod. */
export function createForgeHostServices(
  openRegistry: (cwd: string) => EngineRegistry,
  createAdapter: (registry: EngineRegistry) => EngineAdapter,
  captureAuthority: () => () => void = () => () => {},
): ForgeHostServices {
  return {
    open(context) {
      context.signal.throwIfAborted();
      const assertCurrent = captureAuthority();
      assertCurrent();
      const registry = openRegistry(context.cwd);
      const adapter = guardEngineAdapter(createAdapter(registry), signal => {
        context.signal.throwIfAborted();
        signal?.throwIfAborted();
        assertCurrent();
      });
      return {
        registry, adapter,
        effects: {
          ...createForgeWorkflowEffects(),
          seedNewEnginesFromRegistry: () => { seedNewEnginesFromRegistry(registry); },
        },
      };
    },
  };
}
