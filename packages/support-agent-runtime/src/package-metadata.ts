import type { SupportPackageDescriptor } from '@kernlang/agon-kernel';

export const SUPPORT_PACKAGE = Object.freeze({
  schemaVersion: 1,
  id: '@kernlang/agon-support-agent-runtime',
  apiVersion: 1,
  lifecycle: 'singleton-per-generation',
  capabilities: Object.freeze(["agent-loop","agent-session"]),
}) satisfies SupportPackageDescriptor;
