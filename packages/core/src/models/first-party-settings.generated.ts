// Generated from owner configuration schemas. Run generate-modular-first-party-packages.mjs.
export interface FirstPartyLegacySettings {
  autoReviewAfterForge?: boolean;
  autoReviewAfterImpl?: boolean;
  cesarAgenticContinuationLimit?: number;
  cesarMutateReflex?: boolean;
  corpusReplayLimit?: number;
  forgeEnableSynthesis?: boolean;
  forgeFitnessTimeout?: number;
  forgeSynthesisTimeout?: number;
  gauntletEnabled?: boolean;
  gauntletMaxBreakers?: number;
  gauntletRepairTimeout?: number;
  goalReviewEngines?: string[];
  skillSynthesisThreshold?: number;
}

export const DEFAULT_FIRST_PARTY_SETTINGS: Required<FirstPartyLegacySettings> = {
  "autoReviewAfterForge": true,
  "autoReviewAfterImpl": true,
  "cesarAgenticContinuationLimit": 12,
  "cesarMutateReflex": true,
  "corpusReplayLimit": 5,
  "forgeEnableSynthesis": false,
  "forgeFitnessTimeout": 120,
  "forgeSynthesisTimeout": 300,
  "gauntletEnabled": false,
  "gauntletMaxBreakers": 3,
  "gauntletRepairTimeout": 300,
  "goalReviewEngines": [],
  "skillSynthesisThreshold": 3
};

export { LEGACY_MOD_SETTING_OWNERS } from '@kernlang/agon-kernel';
