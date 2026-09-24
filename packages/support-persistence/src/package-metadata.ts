import type { SupportPackageDescriptor } from '@kernlang/agon-kernel';

export const SUPPORT_PACKAGE = Object.freeze({
  schemaVersion: 1,
  id: '@kernlang/agon-support-persistence',
  apiVersion: 1,
  lifecycle: 'singleton-per-generation',
  capabilities: Object.freeze(["history","events","sessions","plans","locks","runs","history-search"]),
}) satisfies SupportPackageDescriptor;
