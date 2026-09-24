export const SUPPORT_PACKAGE_IDS = Object.freeze([
  '@kernlang/agon-support-engine-runtime',
  '@kernlang/agon-support-engine-catalog',
  '@kernlang/agon-support-persistence',
  '@kernlang/agon-support-verification',
  '@kernlang/agon-support-worktree',
  '@kernlang/agon-support-panel',
  '@kernlang/agon-support-judge',
  '@kernlang/agon-support-agent-runtime',
  '@kernlang/agon-support-dedup',
  '@kernlang/agon-support-browser-bridge',
  '@kernlang/agon-support-saas-api',
] as const);

export type SupportPackageId = typeof SUPPORT_PACKAGE_IDS[number];

/**
 * Static metadata only. Support implementations receive capabilities from the
 * kernel host and therefore import this contract as a type, never a second
 * runtime kernel instance.
 */
export interface SupportPackageDescriptor {
  readonly schemaVersion: 1;
  readonly id: SupportPackageId;
  readonly apiVersion: 1;
  readonly lifecycle: 'singleton-per-generation';
  readonly capabilities: readonly string[];
}

export interface SupportPackageFactory<TCapabilities extends object, TInstance extends object> {
  readonly descriptor: SupportPackageDescriptor;
  create(capabilities: TCapabilities): TInstance | Promise<TInstance>;
}
