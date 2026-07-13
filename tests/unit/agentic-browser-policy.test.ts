import { describe, expect, it } from 'vitest';

import {
  browserResearchEvidenceGap,
  classifyBrowserResearchGoal,
  emptyBrowserResearchEvidence,
  isSelectorGroundingFailure,
  recordSuccessfulBrowserCapability,
  requiresShoppingMutationVerification,
  confirmsShoppingMutationObservation,
  isShoppingAddAction,
} from '../../packages/cli/src/generated/bridge/agentic-browser-policy.js';

describe('deterministic browser research policy', () => {
  it('requires post-action observation only for explicit basket/cart mutation goals with an observation tool', () => {
    expect(requiresShoppingMutationVerification('Put this product in the basket.', true)).toBe(true);
    expect(requiresShoppingMutationVerification('Lege dieses Produkt in den Warenkorb.', true)).toBe(true);
    expect(requiresShoppingMutationVerification('Find products for my basket.', true)).toBe(false);
    expect(requiresShoppingMutationVerification('Put this product in the basket.', false)).toBe(false);
  });

  it('accepts positive visible cart state but rejects an unchanged Add-to-basket page', () => {
    expect(confirmsShoppingMutationObservation('Basket (0 items)\nAdd to basket', 'Basket (1 item)')).toBe(true);
    expect(confirmsShoppingMutationObservation('Warenkorb: 1 Artikel', 'Warenkorb: 2 Artikel')).toBe(true);
    expect(confirmsShoppingMutationObservation('Add to basket', 'Remove from basket')).toBe(true);
    expect(confirmsShoppingMutationObservation('Basket (1 item)', 'Basket (1 item)')).toBe(false);
    expect(confirmsShoppingMutationObservation('', 'Basket (1 item)')).toBe(false);
    expect(confirmsShoppingMutationObservation('Added to basket', 'Added to basket')).toBe(false);
    expect(confirmsShoppingMutationObservation('Add to basket', 'Added to basket')).toBe(true);
    expect(confirmsShoppingMutationObservation('Cart (0)', 'Cart (1)')).toBe(true);
    expect(isShoppingAddAction('click', { selector: 'button.add-to-basket' })).toBe(true);
    expect(isShoppingAddAction('click', { selector: 'button.primary' }, 'clicked Add to cart')).toBe(true);
    expect(isShoppingAddAction('clickAt', { x: 40, y: 50 }, 'clicked left at (40, 50) on "Add to basket"')).toBe(true);
    expect(isShoppingAddAction('click', { selector: 'button.primary' }, 'clicked Add to Shopping Cart')).toBe(true);
    expect(isShoppingAddAction('click', { selector: 'button.checkout' }, 'clicked Checkout')).toBe(false);
  });


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
    expect(classifyBrowserResearchGoal("What's the best way to find the current version of this library?", true, true)).toEqual({
      requiresLiveEvidence: false,
      requiresComparisonTab: false,
    });
    expect(classifyBrowserResearchGoal('How can I look up the current version of this library?', true, true)).toEqual({
      requiresLiveEvidence: false,
      requiresComparisonTab: false,
    });
    expect(classifyBrowserResearchGoal('What is the current version of this library?', true, true)).toEqual({
      requiresLiveEvidence: true,
      requiresComparisonTab: false,
    });
    expect(classifyBrowserResearchGoal('Look up the current version of this library.', true, true)).toEqual({
      requiresLiveEvidence: true,
      requiresComparisonTab: false,
    });
    expect(classifyBrowserResearchGoal('How do I find the best hotels in Paris?', true, true)).toEqual({
      requiresLiveEvidence: true,
      requiresComparisonTab: true,
    });
    expect(classifyBrowserResearchGoal('How can I look up the latest flight prices?', true, true)).toEqual({
      requiresLiveEvidence: true,
      requiresComparisonTab: false,
    });
    expect(classifyBrowserResearchGoal("What's the best way to find cheap flights?", true, true)).toEqual({
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

  it('keeps comparison focus when closing a different, unfocused owned tab', () => {
    const policy = { requiresLiveEvidence: true, requiresComparisonTab: true };
    let evidence = emptyBrowserResearchEvidence();
    evidence = recordSuccessfulBrowserCapability(
      evidence,
      'openTab',
      { url: 'https://source-b.test/' },
      'Workspace tabs (2; * = focused):\n  * [tabId 22] Source B — https://source-b.test/',
    );
    evidence = recordSuccessfulBrowserCapability(
      evidence,
      'openTab',
      { url: 'https://source-c.test/' },
      'Workspace tabs (3; * = focused):\n  * [tabId 33] Source C — https://source-c.test/',
    );
    evidence = recordSuccessfulBrowserCapability(
      evidence,
      'closeTab',
      { tabId: 22 },
      'closed tab 22.\nWorkspace tabs (2; * = focused):\n  * [tabId 33] Source C — https://source-c.test/',
    );
    evidence = recordSuccessfulBrowserCapability(evidence, 'readPage', {});

    expect(browserResearchEvidenceGap(policy, evidence)).toBeNull();
  });

  it('prunes a closed tab from a successful legacy result when input omits tabId', () => {
    let evidence = emptyBrowserResearchEvidence();
    evidence = recordSuccessfulBrowserCapability(evidence, 'openTab', {}, '* [tabId 22] Source B');
    evidence = recordSuccessfulBrowserCapability(evidence, 'openTab', {}, '* [tabId 33] Source C');
    evidence = recordSuccessfulBrowserCapability(
      evidence,
      'closeTab',
      {},
      'closed tab 22.\nWorkspace tabs (1; * = focused):\n  * [tabId 33] Source C',
    );

    expect(evidence.openedTabIds).toEqual([33]);
  });

  it('requires reopening a comparison tab after the only opened tab is closed unobserved', () => {
    const policy = { requiresLiveEvidence: true, requiresComparisonTab: true };
    let evidence = emptyBrowserResearchEvidence();
    evidence = recordSuccessfulBrowserCapability(evidence, 'readPage', {});
    evidence = recordSuccessfulBrowserCapability(evidence, 'openTab', { url: 'https://source-b.test/' }, '* [tabId 22] Source B');
    evidence = recordSuccessfulBrowserCapability(evidence, 'closeTab', { tabId: 22 }, 'closed tab 22.');

    expect(browserResearchEvidenceGap(policy, evidence)).toMatch(/MUST call openTab/i);
  });

  it('does not decrement comparison evidence when closing an unrelated owned tab', () => {
    let evidence = emptyBrowserResearchEvidence();
    evidence = recordSuccessfulBrowserCapability(evidence, 'openTab', {}, '* [tabId 22] Source B');
    evidence = recordSuccessfulBrowserCapability(evidence, 'openTab', {}, '* [tabId 33] Source C');
    evidence = recordSuccessfulBrowserCapability(evidence, 'closeTab', { tabId: 99 }, 'closed tab 99.\n* [tabId 33] Source C');

    expect(evidence.openedTabCount).toBe(2);
    expect(evidence.openedTabIds).toEqual([22, 33]);
  });

  it('does not treat generic connection failures as selector grounding misses', () => {
    expect(isSelectorGroundingFailure('SELECTOR_GROUNDING_FAILED: target changed')).toBe(true);
    expect(isSelectorGroundingFailure('Element not found')).toBe(true);
    expect(isSelectorGroundingFailure('Could not find the target button')).toBe(true);
    expect(isSelectorGroundingFailure('browser connection not found')).toBe(false);
    expect(isSelectorGroundingFailure('could not find the native host process')).toBe(false);
  });
});
