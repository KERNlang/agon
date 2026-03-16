import { describe, it, expect } from 'vitest';
import { detectIntent, SLASH_COMMANDS } from '../../packages/cli/src/intent.js';

// ── Slash Commands ──────────────────────────────────────────────────

describe('Intent Detection — Slash Commands', () => {
  it('/forge <task> parses task', () => {
    const r = detectIntent('/forge fix the auth bug');
    expect(r.type).toBe('forge');
    if (r.type === 'forge') {
      expect(r.task).toBe('fix the auth bug');
      expect(r.fitnessCmd).toBeNull();
    }
  });

  it('/forge with fitness command', () => {
    const r = detectIntent('/forge fix login test with npm test');
    expect(r.type).toBe('forge');
    if (r.type === 'forge') {
      expect(r.fitnessCmd).toBe('npm test');
    }
  });

  it('/forge with no task', () => {
    const r = detectIntent('/forge');
    expect(r.type).toBe('forge');
    if (r.type === 'forge') expect(r.task).toBe('');
  });

  it('/brainstorm parses question', () => {
    const r = detectIntent('/brainstorm best caching strategy?');
    expect(r.type).toBe('brainstorm');
    if (r.type === 'brainstorm') expect(r.question).toBe('best caching strategy?');
  });

  it('/tribunal parses question', () => {
    const r = detectIntent('/tribunal React vs Svelte');
    expect(r.type).toBe('tribunal');
    if (r.type === 'tribunal') expect(r.question).toBe('React vs Svelte');
  });

  it('/campfire parses topic', () => {
    const r = detectIntent('/campfire the future of AI');
    expect(r.type).toBe('campfire');
    if (r.type === 'campfire') expect(r.topic).toBe('the future of AI');
  });

  it('/leaderboard', () => {
    expect(detectIntent('/leaderboard').type).toBe('leaderboard');
    expect(detectIntent('/elo').type).toBe('leaderboard');
  });

  it('/history with optional id', () => {
    const r1 = detectIntent('/history');
    expect(r1.type).toBe('history');
    if (r1.type === 'history') expect(r1.id).toBeUndefined();

    const r2 = detectIntent('/history abc123');
    expect(r2.type).toBe('history');
    if (r2.type === 'history') expect(r2.id).toBe('abc123');
  });

  it('/engines', () => {
    expect(detectIntent('/engines').type).toBe('engines');
  });

  it('/config with actions', () => {
    const r = detectIntent('/config set timeout 120');
    expect(r.type).toBe('config');
    if (r.type === 'config') {
      expect(r.action).toBe('set');
      expect(r.key).toBe('timeout');
      expect(r.value).toBe('120');
    }
  });

  it('/config list', () => {
    const r = detectIntent('/config list');
    expect(r.type).toBe('config');
    if (r.type === 'config') expect(r.action).toBe('list');
  });

  it('/use parses engine IDs', () => {
    const r = detectIntent('/use claude,codex');
    expect(r.type).toBe('use');
    if (r.type === 'use') expect(r.engineIds).toEqual(['claude', 'codex']);
  });

  it('/use with spaces', () => {
    const r = detectIntent('/use claude codex gemini');
    expect(r.type).toBe('use');
    if (r.type === 'use') expect(r.engineIds).toEqual(['claude', 'codex', 'gemini']);
  });

  it('/workspace actions', () => {
    const r = detectIntent('/workspace add /tmp/foo');
    expect(r.type).toBe('workspace');
    if (r.type === 'workspace') {
      expect(r.action).toBe('add');
      expect(r.path).toBe('/tmp/foo');
    }
  });

  it('/ws is shortcut for workspace list', () => {
    const r = detectIntent('/ws');
    expect(r.type).toBe('workspace');
    if (r.type === 'workspace') expect(r.action).toBe('list');
  });

  it('/models and aliases', () => {
    expect(detectIntent('/models').type).toBe('models');
    expect(detectIntent('/setup').type).toBe('models');
  });

  it('/tokens and aliases', () => {
    expect(detectIntent('/tokens').type).toBe('tokens');
    expect(detectIntent('/usage').type).toBe('tokens');
    expect(detectIntent('/cost').type).toBe('tokens');
  });

  it('/plan with optional id', () => {
    expect(detectIntent('/plan').type).toBe('plan');
    const r = detectIntent('/plan abc');
    if (r.type === 'plan') expect(r.planId).toBe('abc');
  });

  it('/plans', () => {
    expect(detectIntent('/plans').type).toBe('plans');
  });

  it('/approve', () => {
    expect(detectIntent('/approve').type).toBe('approve');
  });

  it('/retry and /resume', () => {
    expect(detectIntent('/retry').type).toBe('retry');
    expect(detectIntent('/resume').type).toBe('retry');
  });

  it('/cancel and /abort', () => {
    expect(detectIntent('/cancel').type).toBe('cancel');
    expect(detectIntent('/abort').type).toBe('cancel');
  });

  it('/chat sends to chat', () => {
    const r = detectIntent('/chat hello world');
    expect(r.type).toBe('chat');
    if (r.type === 'chat') expect(r.input).toBe('hello world');
  });

  it('/clear', () => {
    expect(detectIntent('/clear').type).toBe('clear');
  });

  it('/help', () => {
    expect(detectIntent('/help').type).toBe('help');
  });

  it('/exit and /quit', () => {
    expect(detectIntent('/exit').type).toBe('exit');
    expect(detectIntent('/quit').type).toBe('exit');
  });

  it('/ alone shows slash-list', () => {
    expect(detectIntent('/').type).toBe('slash-list');
  });

  it('unknown slash command', () => {
    const r = detectIntent('/notacommand');
    expect(r.type).toBe('unknown');
  });
});

// ── Natural Language Detection ──────────────────────────────────────

describe('Intent Detection — Natural Language', () => {
  it('forge keywords trigger forge', () => {
    const r = detectIntent('fix the login bug');
    expect(r.type).toBe('forge');
  });

  it('debate keywords trigger tribunal', () => {
    expect(detectIntent('should we use Redis vs Postgres').type).toBe('tribunal');
    expect(detectIntent('pros and cons of microservices').type).toBe('tribunal');
  });

  it('brainstorm keywords trigger brainstorm', () => {
    expect(detectIntent('brainstorm ideas for the homepage').type).toBe('brainstorm');
    expect(detectIntent('suggest a better approach').type).toBe('brainstorm');
  });

  it('campfire keywords trigger campfire', () => {
    expect(detectIntent('lets think about the architecture').type).toBe('campfire');
    expect(detectIntent('what if we used WebSockets').type).toBe('campfire');
  });

  it('question words fall back to brainstorm', () => {
    expect(detectIntent('how do I set up auth').type).toBe('brainstorm');
    expect(detectIntent('what is the best ORM').type).toBe('brainstorm');
  });

  it('leaderboard keywords', () => {
    expect(detectIntent('show leaderboard').type).toBe('leaderboard');
    expect(detectIntent('elo rankings').type).toBe('leaderboard');
  });

  it('exit keywords', () => {
    expect(detectIntent('exit').type).toBe('exit');
    expect(detectIntent('quit').type).toBe('exit');
    expect(detectIntent('bye').type).toBe('exit');
  });

  it('help keyword', () => {
    expect(detectIntent('help').type).toBe('help');
    expect(detectIntent('?').type).toBe('help');
  });

  it('truly unknown input', () => {
    expect(detectIntent('hello there').type).toBe('unknown');
    expect(detectIntent('just chatting').type).toBe('unknown');
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────

describe('Intent Detection — Edge Cases', () => {
  it('empty string → unknown', () => {
    const r = detectIntent('');
    expect(r.type).toBe('unknown');
  });

  it('whitespace only → unknown', () => {
    const r = detectIntent('   ');
    expect(r.type).toBe('unknown');
  });

  it('slash commands are case-insensitive', () => {
    expect(detectIntent('/FORGE fix it').type).toBe('forge');
    expect(detectIntent('/Brainstorm why').type).toBe('brainstorm');
  });

  it('SLASH_COMMANDS array is not empty', () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThan(10);
  });

  it('every SLASH_COMMANDS entry has cmd starting with /', () => {
    for (const { cmd } of SLASH_COMMANDS) {
      expect(cmd.startsWith('/')).toBe(true);
    }
  });
});
