import { describe, expect, it } from 'vitest';

import * as persistence from '@kernlang/agon-support-persistence';
import * as verification from '@kernlang/agon-support-verification';
import * as worktree from '@kernlang/agon-support-worktree';
import * as browser from '@kernlang/agon-support-browser-bridge';
import * as dedup from '@kernlang/agon-support-dedup';

import * as legacyFileHistory from '../../packages/core/src/blocks/file-history.js';
import * as legacyEventLog from '../../packages/core/src/sessions/event-log.js';
import * as legacyBrainClient from '../../packages/core/src/sessions/brain-client.js';
import * as legacyFlow from '../../packages/core/src/signals/flow.js';
import * as legacyRunDir from '../../packages/core/src/signals/run-dir.js';
import * as legacyInformationGain from '../../packages/core/src/guards/information-gain.js';
import * as legacyPlan from '../../packages/core/src/blocks/plan.js';
import * as legacyBrowserHost from '../../packages/cli/src/bridge/browser-host.js';
import * as legacyDedup from '../../packages/core/src/blocks/dedup-resolver.js';

describe('S4 compatibility adapter parity', () => {
  it('reexports persistence implementations without a second owner', () => {
    expect(legacyFileHistory.takeSnapshot).toBe(persistence.takeSnapshot);
    expect(legacyEventLog.append).toBe(persistence.append);
    expect(legacyBrainClient.canonicalCapabilityInputDigest).toBe(persistence.canonicalCapabilityInputDigest);
    expect(legacyBrainClient.conservativeControlCapabilities).toBe(persistence.conservativeControlCapabilities);
    expect(legacyFlow.logFlow).toBe(persistence.logFlow);
    expect(legacyFlow.analyzeFlows).toBe(persistence.analyzeFlows);
    expect(legacyRunDir.createRunDir).toBe(persistence.createRunDir);
    expect(legacyRunDir.findLatestRunDir).toBe(persistence.findLatestRunDir);
  });

  it('reexports verification and worktree implementations', () => {
    expect(legacyInformationGain.computeInfoGain).toBe(verification.computeInfoGain);
    expect(legacyPlan.createPlan).toBe(worktree.createPlan);
    expect(legacyPlan.advanceStep).toBe(worktree.advanceStep);
  });

  it('reexports browser and dedup implementations', () => {
    expect(legacyBrowserHost.parseConnRecord).toBe(browser.parseConnRecord);
    expect(legacyBrowserHost.decodeFrames).toBe(browser.decodeFrames);
    expect(legacyDedup.resolveDedupSidecar).toBe(dedup.resolveDedupSidecar);
  });
});
