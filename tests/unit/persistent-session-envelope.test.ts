import { describe, expect, it, vi } from 'vitest';
import {
  withControlPlaneEnvelope,
  type PersistentSession,
  type SessionChunk,
} from '../../packages/core/src/generated/sessions/persistent-session.js';
import type { ControlPlaneEnvelopeV1 } from '../../packages/core/src/generated/sessions/turn-protocol.js';

function createSession(chunks: SessionChunk[]): PersistentSession {
  return {
    alive: true,
    sessionId: 'session-1',
    engineId: 'test',
    start: vi.fn(async () => undefined),
    async *send() {
      for (const chunk of chunks) yield chunk;
    },
    close: vi.fn(),
    getMessageHistory: vi.fn(() => []),
  };
}

async function collect(session: PersistentSession, controlPlane?: ControlPlaneEnvelopeV1): Promise<SessionChunk[]> {
  const chunks: SessionChunk[] = [];
  for await (const chunk of session.send({ message: 'go', controlPlane })) chunks.push(chunk);
  return chunks;
}

describe('persistent session control-plane envelope', () => {
  it('adds the exact turn envelope to every adapter chunk and preserves existing metadata', async () => {
    const envelope: ControlPlaneEnvelopeV1 = {
      schemaVersion: 1,
      sessionId: 'session-1',
      turnId: 'turn-7',
      leaseEpoch: 7,
      attempt: 1,
      producerId: 'session:test',
    };
    const session = createSession([
      { type: 'status', content: 'working', metadata: { phase: 'dispatch' } },
      { type: 'text', content: 'done' },
      { type: 'done', content: '' },
    ]);

    const chunks = await collect(withControlPlaneEnvelope(session), envelope);

    expect(chunks).toEqual([
      { type: 'status', content: 'working', metadata: { phase: 'dispatch', controlPlane: envelope } },
      { type: 'text', content: 'done', metadata: { controlPlane: envelope } },
      { type: 'done', content: '', metadata: { controlPlane: envelope } },
    ]);
  });

  it('leaves chunks untouched when the caller has no control-plane envelope', async () => {
    const original = { type: 'text', content: 'legacy', metadata: { source: 'adapter' } } as const;
    const session = createSession([original]);

    expect(await collect(withControlPlaneEnvelope(session))).toEqual([original]);
  });
});
