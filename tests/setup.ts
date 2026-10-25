// Global vitest setup. Runs once before any test file. Use sparingly —
// per-test setup belongs in the test file's beforeEach.
//
// ── Store isolation (AGON_HOME) ─────────────────────────────────────────
// Every persistence path (ratings.json, telemetry.json, runs/, flows/, …)
// resolves under AGON_HOME when set. Without a baseline here, any test that
// exercises rating/telemetry/run-record code WITHOUT calling
// setupTestAgonHome() itself writes fixture engines (fast/slow/e1/…) into
// the developer's REAL ~/.agon store — on 2026-07-08 the production
// leaderboard's top 4 were `fast*` test doubles with 1,600+ wins. The
// baseline temp dir below guarantees no test file can ever touch ~/.agon,
// even when it forgets per-test isolation. It runs in each vitest worker
// BEFORE any module import, so module-load-frozen path consts (RUNS_DIR,
// AGON_HOME in signals/config.ts) also freeze onto the temp dir.
// tests/helpers/agon-home.ts#cleanupTestAgonHome restores THIS baseline
// (via AGON_TEST_HOME_BASELINE) instead of deleting AGON_HOME, so later
// tests in the same file never fall back to the real home either.
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

const agonHomeBaseline = mkdtempSync(join(tmpdir(), 'agon-test-home-'));
process.env.AGON_TEST_HOME_BASELINE = agonHomeBaseline;
process.env.AGON_HOME = agonHomeBaseline;

// Safety net: several test files `delete process.env.AGON_HOME` in their own
// afterEach. Setup-file hooks are registered FIRST, and vitest runs afterEach
// hooks in reverse registration order, so this one runs LAST — after any
// file-local cleanup — and re-points an unset AGON_HOME at the baseline
// instead of letting the next test fall through to the real ~/.agon.
beforeEach(() => {
  if (!process.env.AGON_HOME?.trim()) process.env.AGON_HOME = agonHomeBaseline;
});
afterEach(() => {
  if (!process.env.AGON_HOME?.trim()) process.env.AGON_HOME = agonHomeBaseline;
});

// Disables the forge pre-flight engine health check during tests: every
// fixture's mock adapter would otherwise need to answer the "say ok"
// probe before stage1/stage2 dispatch, which would invasive-edit every
// test. Production users opt out via forgeHealthCheckEnabled=false or
// --no-health-check. Tests that specifically exercise the health check
// can `delete process.env.AGON_DISABLE_FORGE_HEALTH_CHECK` themselves.
process.env.AGON_DISABLE_FORGE_HEALTH_CHECK = '1';

// Disables the whole-project kern-context spine during tests. runForge and
// runConquer now build it best-effort by spawning the real `kern context`
// CLI (ts-morph, up to ~20s, non-deterministic output), which every forge/
// conquer fixture would otherwise pay and have to assert around. Production
// gets it automatically; a test that specifically exercises the spine can
// set `process.env.AGON_NO_KERN_CONTEXT = ''` (and stub the CLI) itself.
process.env.AGON_NO_KERN_CONTEXT = '1';

// Hermetic child-process environment: workers inherit these, so git/python
// children behave identically on any host locale, global gitignore or gitconfig.
// The disabled classifier sidecar keeps cold-cache temp AGON_HOMEs from paying
// a blocking Python spawn; classifier tests unset it locally.
process.env.AGON_DISABLE_CLASSIFIER_SIDECAR = '1';
process.env.LC_ALL = 'C';
process.env.PYTHONUTF8 = '1';
process.env.GIT_CONFIG_NOSYSTEM = '1';
const emptyGitConfig = join(agonHomeBaseline, 'empty-gitconfig');
writeFileSync(emptyGitConfig, '');
chmodSync(emptyGitConfig, 0o444);
process.env.GIT_CONFIG_GLOBAL = emptyGitConfig;
process.env.GIT_AUTHOR_NAME ??= 'Agon Test';
process.env.GIT_AUTHOR_EMAIL ??= 'agon-test@example.invalid';
process.env.GIT_COMMITTER_NAME ??= 'Agon Test';
process.env.GIT_COMMITTER_EMAIL ??= 'agon-test@example.invalid';
