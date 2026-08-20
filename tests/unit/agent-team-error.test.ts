import { describe, it, expect } from 'vitest';
import { makeAgentTeamError, makeAgentTeamDisposedError } from '../../packages/core/src/cesar/agent-team.js';

// Pins the optional-cause guard: `cause` is attached ONLY when a cause was
// actually supplied. Attaching an undefined `cause` makes `'cause' in err`
// true for causeless errors, which downstream error reporting reads as
// "there is a root cause" and renders an empty chain.

describe('makeAgentTeamError', () => {
  it('prefixes the message and names the error', () => {
    const err = makeAgentTeamError('worktree creation failed');
    expect(err.message).toBe('AgentTeam: worktree creation failed');
    expect(err.name).toBe('AgentTeamError');
  });

  it('does NOT attach a cause property when no cause is supplied', () => {
    const err = makeAgentTeamError('no root cause here');
    expect('cause' in err).toBe(false);
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('attaches the cause verbatim when one IS supplied', () => {
    const root = new Error('ENOENT');
    const err = makeAgentTeamError('worktree creation failed', root);
    expect('cause' in err).toBe(true);
    expect((err as Error & { cause?: unknown }).cause).toBe(root);
  });

  it('attaches a non-Error cause too (a string is still a cause)', () => {
    const err = makeAgentTeamError('boom', 'stringy reason');
    expect('cause' in err).toBe(true);
    expect((err as Error & { cause?: unknown }).cause).toBe('stringy reason');
  });

  it('makeAgentTeamDisposedError is a distinct, causeless error kind', () => {
    const err = makeAgentTeamDisposedError();
    expect(err.name).toBe('AgentTeamDisposedError');
    expect('cause' in err).toBe(false);
  });
});
