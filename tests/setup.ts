// Global vitest setup. Runs once before any test file. Use sparingly —
// per-test setup belongs in the test file's beforeEach.
//
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
