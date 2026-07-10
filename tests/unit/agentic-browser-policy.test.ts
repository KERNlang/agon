import { describe, expect, it } from 'vitest';

import {
  browserResearchEvidenceGap,
  classifyBrowserResearchGoal,
  emptyBrowserResearchEvidence,
  isSelectorGroundingFailure,
  recordSuccessfulBrowserCapability,
} from '../../packages/cli/src/generated/bridge/agentic-browser-policy.js';

describe('deterministic browser research policy', () => {
  it('recognizes German search requests without treating ordinary English "such" as search intent', () => {
    expect(classifyBrowserResearchGoal('Bitte Taucherbrillen suchen', true, true)).toMatchObject({
      requiresLiveEvidence: true,
    });
    expect(classifyBrowserResearchGoal('There is no such thing; explain why.', true, true)).toEqual({
      requiresLiveEvidence: false,
      requiresComparisonTab: false,
    });
  });

  it('does not force live browsing for stable comparison language without a live subject', () => {
    expect(classifyBrowserResearchGoal('Compare React and Vue.', true, true)).toEqual({
      requiresLiveEvidence: false,
      requiresComparisonTab: false,
    });
    expect(classifyBrowserResearchGoal('Recommend a sorting algorithm.', true, true)).toEqual({
      requiresLiveEvidence: false,
      requiresComparisonTab: false,
    });
    expect(classifyBrowserResearchGoal('Find the derivative of x squared.', true, true)).toEqual({
      requiresLiveEvidence: false,
      requiresComparisonTab: false,
    });
    expect(classifyBrowserResearchGoal('Recommend and compare current travel products.', true, true)).toEqual({
      requiresLiveEvidence: true,
      requiresComparisonTab: true,
    });
  });

  it('restores opened-tab evidence after switching away and back before observing it', () => {
    const policy = { requiresLiveEvidence: true, requiresComparisonTab: true };
    let evidence = emptyBrowserResearchEvidence();
    evidence = recordSuccessfulBrowserCapability(
      evidence,
      'openTab',
      { url: 'https://source-b.test/' },
      'Workspace tabs (2; * = focused):\n  * [tabId 22] Source B — https://source-b.test/',
    );
    evidence = recordSuccessfulBrowserCapability(evidence, 'switchTab', { tabId: 11 });
    evidence = recordSuccessfulBrowserCapability(evidence, 'switchTab', { tabId: 22 });
    evidence = recordSuccessfulBrowserCapability(evidence, 'readPage', {});

    expect(browserResearchEvidenceGap(policy, evidence)).toBeNull();
  });

  it('does not treat generic connection failures as selector grounding misses', () => {
    expect(isSelectorGroundingFailure('SELECTOR_GROUNDING_FAILED: target changed')).toBe(true);
    expect(isSelectorGroundingFailure('browser connection not found')).toBe(false);
    expect(isSelectorGroundingFailure('could not find the native host process')).toBe(false);
  });
});
