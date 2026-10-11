// Generated from owner configuration schemas. Run generate-modular-first-party-packages.mjs.
export interface FirstPartyLegacySettings {
  autoReviewAfterForge?: boolean;
  forgeFitnessTimeout?: number;
}

export const DEFAULT_FIRST_PARTY_SETTINGS: Required<FirstPartyLegacySettings> = {
  "autoReviewAfterForge": true,
  "forgeFitnessTimeout": 120
};
