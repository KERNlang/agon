export interface RoomActor {
  actorId: string;
  callsign: string;
  kind: 'human' | 'external-cli' | 'agon-engine' | 'cesar';
  engineId?: string;
  cli: string;
  humanOwner?: string;
}

export interface RoomEvent {
  seq: number;
  id: string;
  roomId: string;
  kind: string;
  createdAt: string;
  actor: RoomActor;
  repoHint: string;
  body: string;
  mentions: string[];
  replyTo: string | null;
  auto?: boolean;
  lock?: { resource: string; expiresAt: string; stolenFromSeq?: number };
  task?: { taskId: string; status?: 'open' | 'claimed' | 'done' | 'failed'; target?: string; leaseExpiresAt?: string; exitCode?: number; claimOfSeq?: number };
}

export interface RoomMeta {
  roomId: string;
  name: string;
  createdAt: string;
  nextSeq: number;
  closed: boolean;
}

export interface PresenceEntry {
  callsign: string;
  actorId: string;
  status: 'here' | 'stale' | 'left';
  lastSeenAt: string;
  lastReadSeq: number;
  auto: boolean;
  cli: string;
}

export interface RoomLockState {
  resource: string;
  holder: string;
  actorId: string;
  seq: number;
  acquiredAt: string;
  expiresAt: string;
  status: 'active' | 'expired';
  stolenFromSeq?: number;
}

export interface RoomUnreadState {
  callsign: string;
  lastReadSeq: number;
  headSeq: number;
  unreadCount: number;
  mentionCount: number;
}

export interface TurnLease {
  leaseId: string;
  holder: string;
  triggerSeq: number;
  acquiredAt: string;
  expiresAt: string;
}

export interface AutoConfig {
  callsign: string;
  openFloor: boolean;
  quietMs: number;
  maxTurns: number;
  maxWallMs: number;
  stopPhrase: string;
  untilHuman: boolean;
}

export interface AutoState {
  turns: number;
  startedAtMs: number;
  lastSelfSeq: number;
}

export interface StopDecision {
  stop: boolean;
  reason: string;
}

export interface TriggerDecision {
  trigger: boolean;
  triggerSeq: number;
  reason: string;
}

export interface TailCursor {
  offset: number;
  partial: string;
}

export interface TailDrain {
  events: RoomEvent[];
  cursor: TailCursor;
  reset: boolean;
}

export interface RoomTaskState {
  taskId: string;
  status: 'open' | 'claimed' | 'done' | 'failed';
  spec: string;
  target: string | null;
  createdBy: string;
  createdAt: string;
  seq: number;
  claimedBy: string | null;
  claimSeq?: number;
  leaseExpiresAt: string | null;
  result: string | null;
  exitCode?: number;
}

export interface WorkConfig {
  callsign: string;
  maxWallMs: number;
  leaseTtlMs: number;
  taskTimeoutMs: number;
}

export interface WorkState {
  startedAtMs: number;
  tasksHandled: number;
  joinSeq: number;
}
