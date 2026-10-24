import { CORPUS_PATH } from '@kernlang/agon-core';
import { createForgeCorpus } from '@kernlang/agon-mod-forge';

export type { CorpusRecord } from '@kernlang/agon-mod-forge';

// Preserve the legacy storage location and public functions during migration.
export const { loadCorpus, saveCorpus, addToCorpus, extractPattern, getCorpusForReplay, getGapPatterns, getCorpusStats } = createForgeCorpus(CORPUS_PATH);
