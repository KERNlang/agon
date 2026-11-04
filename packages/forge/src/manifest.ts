import { RUNS_DIR, withFileLock } from '@kernlang/agon-core';
import { createForgeManifestStore } from '@kernlang/agon-mod-forge';

export { readManifest } from '@kernlang/agon-mod-forge';

export const { writeManifest, updateManifest } = createForgeManifestStore({
  runsDir: RUNS_DIR,
  withFileLock,
});
