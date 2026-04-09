import { describe, expectTypeOf, it } from 'vitest';

import type { Intent } from '../../packages/cli/src/intent.js';

describe('Intent type coverage', () => {
  it('includes the team command variants', () => {
    expectTypeOf<Extract<Intent, { type: 'team-tribunal' }>>().toEqualTypeOf<{
      type: 'team-tribunal';
      question: string;
      tribunalMode?: string;
      membersPerSide?: number;
    }>();

    expectTypeOf<Extract<Intent, { type: 'team-forge' }>>().toEqualTypeOf<{
      type: 'team-forge';
      task: string;
      fitnessCmd: string | null;
      membersPerSide?: number;
    }>();

    expectTypeOf<Extract<Intent, { type: 'team-brainstorm' }>>().toEqualTypeOf<{
      type: 'team-brainstorm';
      question: string;
      membersPerSide?: number;
    }>();
  });

  it('matches the newer non-team parser variants', () => {
    expectTypeOf<Extract<Intent, { type: 'cesar' }>>().toEqualTypeOf<{
      type: 'cesar';
      engineIds: string[];
    }>();

    expectTypeOf<Extract<Intent, { type: 'chats-resume' }>>().toEqualTypeOf<{
      type: 'chats-resume';
      sessionId: string;
    }>();

    expectTypeOf<Extract<Intent, { type: 'focus' }>>().toEqualTypeOf<{
      type: 'focus';
      jobId?: string;
    }>();
  });
});
