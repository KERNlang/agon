// Generated from owner configuration schemas. Run generate-modular-first-party-packages.mjs.
export interface FirstPartyLegacySettings {
  autoReviewAfterForge?: boolean;
  autoReviewAfterImpl?: boolean;
  cesarAgenticContinuationLimit?: number;
  cesarMutateReflex?: boolean;
  chairExplorationRate?: number;
  corpusReplayLimit?: number;
  forgeEnableSynthesis?: boolean;
  forgeFitnessTimeout?: number;
  forgeSynthesisTimeout?: number;
  gauntletEnabled?: boolean;
  gauntletMaxBreakers?: number;
  gauntletRepairTimeout?: number;
  goalReviewEngines?: string[];
  ratingBallotMaxChars?: number;
  ratingIdentityConfirmRuns?: number;
  ratingJudgeTimeoutSec?: number;
  ratingJudging?: "off" | "shadow" | "on";
  ratingMinBallots?: number;
  ratingStaleHorizonDays?: number;
  skillSynthesisThreshold?: number;
}

export const DEFAULT_FIRST_PARTY_SETTINGS: Required<FirstPartyLegacySettings> = {
  "autoReviewAfterForge": true,
  "autoReviewAfterImpl": true,
  "cesarAgenticContinuationLimit": 12,
  "cesarMutateReflex": true,
  "chairExplorationRate": 0.2,
  "corpusReplayLimit": 5,
  "forgeEnableSynthesis": false,
  "forgeFitnessTimeout": 120,
  "forgeSynthesisTimeout": 300,
  "gauntletEnabled": false,
  "gauntletMaxBreakers": 3,
  "gauntletRepairTimeout": 300,
  "goalReviewEngines": [],
  "ratingBallotMaxChars": 60000,
  "ratingIdentityConfirmRuns": 2,
  "ratingJudgeTimeoutSec": 180,
  "ratingJudging": "shadow",
  "ratingMinBallots": 2,
  "ratingStaleHorizonDays": 90,
  "skillSynthesisThreshold": 3
};

export { LEGACY_MOD_SETTING_OWNERS } from '@kernlang/agon-kernel';
