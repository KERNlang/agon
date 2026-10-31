/** @deprecated Import the public Engine Runtime owner. */
export {
  validateControlPlaneEnvelope,
  controlPlaneIdentity,
  isCurrentControlPlaneEnvelope,
  isCurrentCesarResponse,
  isTerminalTurnState,
  reduceTurnLifecycle,
} from '@kernlang/agon-support-engine-runtime';
export type {
  TurnLifecycleState,
  ControlPlaneEnvelopeV1,
  ControlPlaneEnvelopeValidation,
  TurnLifecycleTransition,
} from '@kernlang/agon-support-engine-runtime';
