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
