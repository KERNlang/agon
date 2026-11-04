/** Settings owned by @kernlang/agon-support-persistence. */
export interface PersistenceSettings {
  sessionContinuity?: boolean;
  cesarDirectThreshold?: number;
  cesarCodeFastPathChars?: number;
  cesarMcpConfigPath?: string;
  cesarSensitivePathPatterns: string[];
  cesarApprovalLedger?: boolean;
}

export const DEFAULT_PERSISTENCE_SETTINGS: Required<PersistenceSettings> = {
  sessionContinuity: false,
  cesarDirectThreshold: 85,
  cesarCodeFastPathChars: 180,
  cesarMcpConfigPath: '',
  cesarSensitivePathPatterns: [],
  cesarApprovalLedger: true,
};
