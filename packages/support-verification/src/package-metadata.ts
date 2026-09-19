import type { SupportPackageDescriptor } from '@kernlang/agon-kernel';

export const SUPPORT_PACKAGE = Object.freeze({
  schemaVersion: 1,
  id: '@kernlang/agon-support-verification',
  apiVersion: 1,
  lifecycle: 'singleton-per-generation',
  capabilities: Object.freeze(["guard-telemetry","checker-discovery","information-gain","shadow-verdicts"]),
}) satisfies SupportPackageDescriptor;
