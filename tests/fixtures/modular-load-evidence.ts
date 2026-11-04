/** Synthetic positive control. This is not a measured release receipt. */
export function loadEvidenceFixture() {
  return {
    schemaVersion: 1, measurement: 'modular-agon-load', passed: true,
    platform: `${process.platform}-${process.arch}`, node: process.version,
    phases: ['transport', 'workflow'].map(id => ({
      id, passed: true, shutdown: true, shutdownMs: 100, durationMs: 120000, completedJobs: 256,
      verifiedOutputs: 256, requestP95Ms: 20, peakDaemonRssBytes: 150 * 1024 * 1024,
      peakTreeRssBytes: 600 * 1024 * 1024, settledRssGrowthBytes: 1024 * 1024,
      rssSampleCount: 480, maxRetainedJobs: 100,
      fixtureStarts: 256, fixtureEnds: 256, peakFixtureConcurrency: 4, pendingFixtures: 0,
      controls: { failedJob: true, cancelledJob: true, cancelledEngineGone: true,
        recovery: true, shutdownEngineGone: true, hostFilesRemoved: true },
    })),
  };
}
