# Shopping Action Autonomy and KERN Guard Compatibility

**Status:** DONE
**Date:** 2026-07-12
**Confidence:** 0.93

## Executive Summary

MiniMax can inspect and research shopping pages but may stop with a prose refusal claiming that approval-gated generic browser tools cannot add products to a basket. The browser already exposes the necessary click/type/navigation capabilities and the bridge already owns approval orchestration, so the fix is to make that contract explicit and retry this specific false limitation claim instead of changing browser authority. The same PR also needs to qualify `TypeError` through `globalThis` so KERN Guard can verify its scope without changing the runtime error class.

## Current State / Root Cause

- **VERIFIED:** The prompt labels every non-read-only tool as `the user must approve`, but its shopping guidance never says that generic `click` performs add-to-basket actions or that approval is handled by the bridge (`packages/cli/src/kern/bridge/agentic-brain-client.kern:192-319`).
- **VERIFIED:** Long tool-limitation refusals are neither short action narration nor one of the current question-shaped deferrals, so they can terminate a turn after research (`packages/cli/src/kern/bridge/agentic-brain-client.kern:379-404`, `packages/cli/src/kern/bridge/agentic-brain-client.kern:664-744`).
- **VERIFIED:** The extension exposes `click`, `clickAt`, `type`, `insertText`, `navigate`, and tab tools, and routes page-changing actions through an independent policy/approval layer (`../agon-extension/src/agent-tools.ts:15-158`, `../agon-extension/src/sidepanel.ts:1727-1860`).
- **VERIFIED:** `TypeError` is referenced six times in one inline KERN handler without a KERN declaration; other source handlers qualify non-default globals through `globalThis` (`packages/core/src/kern/sessions/brain-client.kern:83-113`, `packages/core/src/kern/rooms/tail.kern:58`).

## What Already Works

- Keep the extension tool catalog, site blocks, grounding checks, approval leases, and autonomy modes unchanged.
- Keep checkout/payment/password risk classification unchanged; this fix makes the model attempt the requested browser action and leaves authorization to the existing policy.
- Keep `TypeError` runtime semantics so callers and tests still receive the intended error class.

## Contract (Verified)

> Verified against the Agon-AI feature worktree and sibling extension on 2026-07-12.

| Behavior | Producer | Consumer | Evidence | Tag |
|---|---|---|---|---|
| Generic page mutation | extension `click`/`clickAt`/`type` tools | agent brain native or marker tool call | `../agon-extension/src/agent-tools.ts:15-158` | VERIFIED |
| Approval orchestration | brain emits `approval-request` before destructive capability | submitting client and extension authorization lease | `packages/cli/src/kern/bridge/agentic-brain-client.kern:804-872` | VERIFIED |
| Local execution policy | extension autonomy/site/risk gate | capability executor | `../agon-extension/src/sidepanel.ts:1727-1860` | VERIFIED |
| Digest failure class | `canonicalCapabilityInputDigest` | authorization tests/callers | `packages/core/src/kern/sessions/brain-client.kern:83-113` | VERIFIED |

## Implementation Options

### Recommended — prompt contract plus bounded false-limitation retry

Teach the agent that generic browser tools cover shopping actions, that it must emit the action and let the bridge handle approval, and classify strong false capability/approval limitation claims as a bounded autonomous deferral when mutating browser tools exist. Qualify `TypeError` as `globalThis.TypeError`.

Prompt-only is insufficient because the captured failure already ignored broad autonomous wording. Removing approvals would solve the wrong problem and weaken safety.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/cli/src/kern/bridge/agentic-brain-client.kern` | Modify | Clarify shopping capability and retry false limitation prose |
| `packages/cli/src/kern/bridge/agentic-browser-policy.kern` | Modify | Classify explicit basket mutation goals for post-action evidence |
| `packages/cli/src/generated/bridge/agentic-brain-client.ts` | Regenerate | Keep generated output in sync |
| `packages/core/src/kern/sessions/brain-client.kern` | Modify | Qualify `TypeError` for KERN Guard |
| `packages/core/src/generated/sessions/brain-client.ts` | Regenerate | Keep generated output in sync |
| `tests/unit/agentic-brain-client.test.ts` | Modify | Reproduce MiniMax refusal and prompt contract |
| `tests/unit/agentic-browser-policy.test.ts` | Modify | Pin basket-mutation intent without false positives |
| `../agon-extension/src/computer-use-runtime.ts` | Modify | Preserve the already-verified coordinate target label in successful `clickAt` results |
| `../agon-extension/src/selector-action-runtime.ts` | Modify | Preserve the revalidated selector target label in successful `click` results |
| `../agon-extension/tests/computer-use-runtime.test.ts` | Modify | Pin semantic `clickAt` result metadata without weakening target revalidation |
| `../agon-extension/tests/selector-action-runtime.test.ts` | Modify | Pin semantic selector-click metadata after exact target revalidation |

## Acceptance Criteria

- [x] The exact captured refusal pattern is recognized as a false tool-limitation deferral when browser mutation tools are available.
- [x] A scripted engine that first emits that refusal is nudged and can then issue an add-to-basket click instead of ending the turn.
- [x] The system prompt states that generic click/type tools cover add-to-basket flows and that approval gates are not evidence of incapability.
- [x] After an add-to-basket action, the loop requires a fresh successful page observation before accepting a completion claim.
- [x] Genuine completed answers and genuine external blockers such as login/CAPTCHA are not classified as this false limitation.
- [x] KERN checks no longer report an undefined `TypeError`, while invalid digest inputs still throw `TypeError` at runtime.
- [x] A visual `clickAt` on a labeled Add-to-basket control returns that verified label so post-action verification is armed.
- [x] Explicit basket goals require a `readPage` baseline before a coordinate click, whose verified result label decides whether verification is armed.
- [x] Explicit basket goals require a `readPage` baseline before selector clicks whose successful result may be the first evidence that the click added an item.
- [x] While basket verification is pending, explicit navigation/tab changes are blocked until the resulting page is observed.
- [x] While basket verification is pending, every registered page-mutating tool is blocked until the resulting page is observed.
- [x] Common `Add to Shopping Cart` labels arm the same verification contract.
- [x] A fresh non-confirming post-add observation permits recovery mutations while final success remains blocked until confirmation.
- [x] Every compliant `readPage` resets the pre-click baseline reminder budget.
- [x] During explicit basket goals, every click/clickAt requires a baseline; verified target labels distinguish add actions from options and checkout before arming post-action verification.
- [x] Focused tests, full tests, typecheck, build, and `agon review -e claude,codex,agy` pass.

## Out of Scope

- Bypassing checkout confirmation, payment protection, login, CAPTCHA, site blocks, or Chrome permission prompts.
- Native desktop automation outside ordinary web pages.
- Extension UI changes.

## Open Questions

None. Existing policy decides approval behavior per configured autonomy mode.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| A representative refusal sentence would adequately test the classifier. | Nero correctly noted that such a test would encode the proposed classifier rather than replay the field failure. | The regression uses the captured MiniMax refusal text and asserts both classification and end-to-end nudge-to-click behavior. |
| Issuing the basket click is sufficient evidence of completion. | Hydrated storefronts can ignore a click or require variants; a successful transport result is not necessarily a changed basket. | The prompt requires a fresh read/screenshot after the action and a visible basket/cart state change before claiming success. |
| Prompt guidance alone would reliably force post-click verification. | Agon review proved the loop accepted immediate prose after a successful click. | Explicit basket goals now set a deterministic verification requirement that only a successful later observation clears. |
| The coordinate click result carried enough semantic evidence to recognize visual Add-to-basket actions. | Agon review showed `clickAt({x,y})` returned only coordinates even though the extension had already verified the target label. | Preserve that verified label in the successful result; do not trust model-supplied labels. |
| Verification could remain valid across explicit navigation or tab changes. | A later observation could come from a different page and be compared with the stale basket baseline. | Block navigation/tab mutations while verification is pending and require observation first. |

## Deploy Order

Ship the extension label-enrichment change first, then Agon-AI. Older Agon-AI versions safely ignore the richer tool-result text. The new Agon-AI remains safe with older extensions, but generic selector/coordinate clicks may fail closed as unverifiable until the extension is upgraded.
