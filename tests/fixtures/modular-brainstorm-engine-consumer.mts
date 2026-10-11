// Compile only. Resolve public package declarations without repository path aliases.
import { runBrainstorm, runScout } from '@kernlang/agon-forge';
import type { EngineRegistry, EngineAdapter } from '@kernlang/agon-core';
import { createBrainstormEngineServices, createBrainstormRuntime } from '@kernlang/agon-mod-brainstorm';
import type { BrainstormEngineEffects, BrainstormEngineOptions } from '@kernlang/agon-mod-brainstorm';

declare const registry: EngineRegistry;
declare const adapter: EngineAdapter;
declare const effects: BrainstormEngineEffects<EngineRegistry>;
const options = { question: 'question', engines: ['fixture'], registry, adapter, timeout: 80, outputDir: '/fixture' };
const typed: BrainstormEngineOptions<EngineRegistry> = options;
void runBrainstorm(options);
void runScout({ ...options, scoutCount: 1 });
void createBrainstormRuntime(createBrainstormEngineServices(effects)).collectRankedDrafts(typed);
