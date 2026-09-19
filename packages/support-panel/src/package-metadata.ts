import type { SupportPackageDescriptor } from '@kernlang/agon-kernel';

export const SUPPORT_PACKAGE = Object.freeze({
  schemaVersion: 1,
  id: '@kernlang/agon-support-panel',
  apiVersion: 1,
  lifecycle: 'singleton-per-generation',
  capabilities: Object.freeze(["panel-health","seat-dispatch"]),
}) satisfies SupportPackageDescriptor;
