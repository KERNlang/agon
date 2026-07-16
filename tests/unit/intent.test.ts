import { describe, it, expect } from 'vitest';
import { detectIntent, SLASH_COMMANDS } from '../../packages/cli/src/intent.js';

// ── Slash Commands ──────────────────────────────────────────────────

describe('Intent Detection — Slash Commands', () => {
  it('/jobs cancel parses the target job id', () => {
    const r = detectIntent('/jobs cancel 42');
    expect(r).toMatchObject({ type: 'jobs', action: 'cancel', jobId: '42' });
  });

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

  it('/chrome parses the task into input (not aliased to another mode)', () => {
    const r = detectIntent('/chrome open the pricing page and check the hero');
    expect(r.type).toBe('chrome');
    expect(r.input).toBe('open the pricing page and check the hero');
  });

  it('/raw parses with no index', () => {
    const r = detectIntent('/raw');
    expect(r.type).toBe('raw');
    if (r.type === 'raw') expect(r.index).toBeUndefined();
  });

  it('/raw parses a numeric page index', () => {
    const r = detectIntent('/raw 3');
    expect(r.type).toBe('raw');
    if (r.type === 'raw') expect(r.index).toBe(3);
  });

  it('/raw ignores a non-numeric arg (defaults to most recent)', () => {
    const r = detectIntent('/raw foo');
    expect(r.type).toBe('raw');
    if (r.type === 'raw') expect(r.index).toBeUndefined();
  });

  it('/team-tribunal parses size and mode', () => {
    const r = detectIntent('/team-tribunal 3v3 synthesis What should we launch first?');
    expect(r.type).toBe('team-tribunal');
    if (r.type === 'team-tribunal') {
      expect(r.membersPerSide).toBe(3);
      expect(r.tribunalMode).toBe('synthesis');
      expect(r.question).toBe('What should we launch first?');
    }
  });

  it('/team-forge parses size, task, and fitness command', () => {
    const r = detectIntent('/team-forge 2v2 fix auth test with npm test');
    expect(r.type).toBe('team-forge');
    if (r.type === 'team-forge') {
      expect(r.membersPerSide).toBe(2);
      expect(r.task).toBe('fix auth');
      expect(r.fitnessCmd).toBe('npm test');
    }
  });

  it('/team-brainstorm parses size and question', () => {
    const r = detectIntent('/team-brainstorm 2v2 Which feature should headline v1?');
    expect(r.type).toBe('team-brainstorm');
    if (r.type === 'team-brainstorm') {
      expect(r.membersPerSide).toBe(2);
      expect(r.question).toBe('Which feature should headline v1?');
    }
  });

  it('/campfire parses topic', () => {
    const r = detectIntent('/campfire the future of AI');
    expect(r.type).toBe('campfire');
    if (r.type === 'campfire') expect(r.topic).toBe('the future of AI');
  });

  it('/think parses problem (no longer aliases to campfire)', () => {
    const r = detectIntent('/think how should we shard the cache?');
    expect(r.type).toBe('think');
    expect((r as any).input).toBe('how should we shard the cache?');
  });

  it('/think parses --strategy and --steps flags out of the problem', () => {
    const r = detectIntent('/think --strategy reflexion --steps 8 design the retry policy');
    expect(r.type).toBe('think');
    expect((r as any).strategy).toBe('reflexion');
    expect((r as any).steps).toBe(8);
    expect((r as any).input).toBe('design the retry policy');
  });

  it('/council parses decision', () => {
    const r = detectIntent('/council should we adopt event sourcing?');
    expect(r.type).toBe('council');
    expect((r as any).question).toBe('should we adopt event sourcing?');
  });

  it('/synthesis parses prompt and --swaps', () => {
    const r = detectIntent('/synthesis --swaps 2 write a rate limiter');
    expect(r.type).toBe('synthesis');
    expect((r as any).swaps).toBe(2);
    expect((r as any).input).toBe('write a rate limiter');
  });

  it('/research parses the question', () => {
    const r = detectIntent('/research how does the p-retry npm package back off?');
    expect(r.type).toBe('research');
    expect((r as any).question).toBe('how does the p-retry npm package back off?');
  });

  it('/research parses --count and --engine out of the question', () => {
    const r = detectIntent('/research the WHATWG URL spec --count 8 --engine codex');
    expect(r.type).toBe('research');
    expect((r as any).question).toBe('the WHATWG URL spec');
    expect((r as any).count).toBe(8);
    expect((r as any).engineId).toBe('codex');
  });

  it('bare /nero toggles in-session adversarial mode', () => {
    const r = detectIntent('/nero');
    expect(r.type).toBe('nero');
  });

  it('/nero <decision> fires a standalone challenge', () => {
    const r = detectIntent('/nero ship the migration without a backfill');
    expect(r.type).toBe('nero-challenge');
    expect((r as any).input).toBe('ship the migration without a backfill');
  });

  it('/nero <decision> --reasoning captures the reasoning tail', () => {
    const r = detectIntent('/nero drop the index --reasoning it is never queried');
    expect(r.type).toBe('nero-challenge');
    expect((r as any).input).toBe('drop the index');
    expect((r as any).reasoning).toBe('it is never queried');
  });

  it('/conquer parses task + --gate', () => {
    const r = detectIntent('/conquer build a CSV importer --gate "npm run build && npm test"');
    expect(r.type).toBe('conquer');
    expect((r as any).task).toBe('build a CSV importer');
    expect((r as any).gate).toBe('npm run build && npm test');
  });

  it('/conquer parses --builder, -e, and --max-turns out of the task', () => {
    const r = detectIntent('/conquer add OAuth --gate "npm test" --builder codex -e claude,agy --max-turns 20');
    expect(r.type).toBe('conquer');
    expect((r as any).task).toBe('add OAuth');
    expect((r as any).gate).toBe('npm test');
    expect((r as any).builder).toBe('codex');
    expect((r as any).engineIds).toEqual(['claude', 'agy']);
    expect((r as any).maxTurns).toBe(20);
  });

  it('/conquer parses the CLI-parity timing flags out of the task', () => {
    const r = detectIntent('/conquer add OAuth --gate "npm test" --gate-timeout 900 --max-hours 2.5 --timeout 300');
    expect(r.type).toBe('conquer');
    expect((r as any).task).toBe('add OAuth');
    expect((r as any).gate).toBe('npm test');
    expect((r as any).gateTimeout).toBe(900);
    expect((r as any).maxHours).toBe(2.5);
    expect((r as any).turnTimeout).toBe(300);
  });

  it('/conquer --gate-timeout does not get swallowed by the --gate or --timeout parsers', () => {
    const r = detectIntent('/conquer fix parser --gate-timeout 900');
    expect(r.type).toBe('conquer');
    expect((r as any).task).toBe('fix parser');
    expect((r as any).gate).toBeUndefined();
    expect((r as any).gateTimeout).toBe(900);
    expect((r as any).turnTimeout).toBeUndefined();
  });

  it('think/council/synthesis/conquer appear in the /help slash list', () => {
    for (const cmd of ['/think', '/council', '/synthesis', '/conquer']) {
      expect(SLASH_COMMANDS.some((c) => c.cmd === cmd)).toBe(true);
    }
  });

  it('/review parses explicit engine and target in either order', () => {
    const engineFirst = detectIntent('/review with gemini branch:main');
    expect(engineFirst.type).toBe('review');
    if (engineFirst.type === 'review') {
      expect(engineFirst.engineId).toBe('gemini');
      expect(engineFirst.engineIds).toEqual(['gemini']);
      expect(engineFirst.target).toBe('branch:main');
    }

    const targetFirst = detectIntent('/review commit:abc123 with claude');
    expect(targetFirst.type).toBe('review');
    if (targetFirst.type === 'review') {
      expect(targetFirst.engineId).toBe('claude');
      expect(targetFirst.engineIds).toEqual(['claude']);
      expect(targetFirst.target).toBe('commit:abc123');
    }
  });

  it('/review keeps multiple explicit engines', () => {
    const r = detectIntent('/review with codex gemini branch:main');
    expect(r.type).toBe('review');
    if (r.type === 'review') {
      expect(r.engineId).toBe('codex');
      expect(r.engineIds).toEqual(['codex', 'gemini']);
      expect(r.target).toBe('branch:main');
    }

    const comma = detectIntent('/review branch:main with codex,gemini');
    expect(comma.type).toBe('review');
    if (comma.type === 'review') {
      expect(comma.engineIds).toEqual(['codex', 'gemini']);
      expect(comma.target).toBe('branch:main');
    }
  });

  it('/review treats bare engine names as engines without a "with" keyword', () => {
    const r = detectIntent('/review codex claude');
    expect(r.type).toBe('review');
    if (r.type === 'review') {
      expect(r.engineIds).toEqual(['codex', 'claude']);
      expect(r.engineId).toBe('codex');
      // no explicit target → defaults downstream to uncommitted
      expect(r.target).toBeUndefined();
    }

    // target still parses alongside bare engine names, in any order
    const withTarget = detectIntent('/review branch:main codex claude');
    expect(withTarget.type).toBe('review');
    if (withTarget.type === 'review') {
      expect(withTarget.engineIds).toEqual(['codex', 'claude']);
      expect(withTarget.target).toBe('branch:main');
    }

    // three space-separated engines, no target → defaults to uncommitted
    const three = detectIntent('/review codex claude agy');
    expect(three.type).toBe('review');
    if (three.type === 'review') {
      expect(three.engineIds).toEqual(['codex', 'claude', 'agy']);
      expect(three.target).toBeUndefined();
    }
  });

  it('/leaderboard', () => {
    expect(detectIntent('/leaderboard').type).toBe('leaderboard');
    expect(detectIntent('/elo').type).toBe('leaderboard');
  });

  it('/undo accepts an explicit checkpoint id', () => {
    const direct = detectIntent('/undo abc12345');
    expect(direct.type).toBe('undo');
    if (direct.type === 'undo') expect(direct.snapshotId).toBe('abc12345');

    const named = detectIntent('/undo checkpoint abc12345');
    expect(named.type).toBe('undo');
    if (named.type === 'undo') expect(named.snapshotId).toBe('abc12345');
  });

  it('/checkpoints lists recent checkpoint snapshots', () => {
    expect(detectIntent('/checkpoints').type).toBe('checkpoints');
  });

  it('/history with optional id', () => {
    const r1 = detectIntent('/history');
    expect(r1.type).toBe('history');
    if (r1.type === 'history') expect(r1.id).toBeUndefined();

    const r2 = detectIntent('/history abc123');
    expect(r2.type).toBe('history');
    if (r2.type === 'history') expect(r2.id).toBe('abc123');
  });

  it('/harness-replay parses optional turn id', () => {
    const r = detectIntent('/harness-replay cesar-abc123');
    expect(r.type).toBe('harness-replay');
    if (r.type === 'harness-replay') expect(r.turnId).toBe('cesar-abc123');
  });

  it('/auto and /autonomous parse clean tasks with autonomous mode enabled', () => {
    const auto = detectIntent('/auto fix login and run tests');
    expect(auto.type).toBe('auto');
    if (auto.type === 'auto') {
      expect(auto.input).toBe('fix login and run tests');
      expect(auto.taskClass).toBe('code');
      expect(auto.autoMode).toBe(true);
    }

    const autonomous = detectIntent('/autonomous explain the harness flow');
    expect(autonomous.type).toBe('auto');
    if (autonomous.type === 'auto') {
      expect(autonomous.input).toBe('explain the harness flow');
      expect(autonomous.autoMode).toBe(true);
    }
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

  it('/cli-models aliases are removed', () => {
    expect(detectIntent('/cli-models').type).toBe('unknown');
    expect(detectIntent('/cli-model').type).toBe('unknown');
  });

  it('/models cli routes to engine/model picker', () => {
    expect(detectIntent('/models cli').type).toBe('engines');
    expect(detectIntent('/models engines').type).toBe('engines');
    expect(detectIntent('/models engine').type).toBe('engines');
  });

  it('/engines supports persistent hide/remove/restore actions', () => {
    const hide = detectIntent('/engines hide ollama');
    expect(hide.type).toBe('engines');
    if (hide.type === 'engines') {
      expect(hide.action).toBe('hide');
      expect(hide.id).toBe('ollama');
    }

    const remove = detectIntent('/engines remove qwen');
    expect(remove.type).toBe('engines');
    if (remove.type === 'engines') {
      expect(remove.action).toBe('remove');
      expect(remove.id).toBe('qwen');
    }

    const restore = detectIntent('/engines restore ollama');
    expect(restore.type).toBe('engines');
    if (restore.type === 'engines') {
      expect(restore.action).toBe('restore');
      expect(restore.id).toBe('ollama');
    }
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

  it('/cp with index', () => {
    const r = detectIntent('/cp 3');
    expect(r.type).toBe('cp');
    if (r.type === 'cp') expect(r.index).toBe(3);
  });

  it('/cp without index', () => {
    const r = detectIntent('/cp');
    expect(r.type).toBe('cp');
    if (r.type === 'cp') expect(r.index).toBeUndefined();
  });

  it('/copy alias', () => {
    const r = detectIntent('/copy 1');
    expect(r.type).toBe('cp');
    if (r.type === 'cp') expect(r.index).toBe(1);
  });

  it('/cp last copies the last response', () => {
    const r = detectIntent('/cp last');
    expect(r.type).toBe('cp');
    if (r.type === 'cp') {
      expect(r.last).toBe(true);
      expect(r.index).toBeUndefined();
    }
  });

  it('/copy last alias and case-insensitive variants', () => {
    for (const input of ['/copy last', '/cp LAST', '/cp msg', '/cp response']) {
      const r = detectIntent(input);
      expect(r.type).toBe('cp');
      if (r.type === 'cp') expect(r.last).toBe(true);
    }
  });

  it('/img parses path', () => {
    const r = detectIntent('/img /tmp/screenshot.png');
    expect(r.type).toBe('img');
    if (r.type === 'img') expect(r.path).toBe('/tmp/screenshot.png');
  });

  it('/image alias works', () => {
    const r = detectIntent('/image foo.png');
    expect(r.type).toBe('img');
    if (r.type === 'img') expect(r.path).toBe('foo.png');
  });

  it('/chat sends to chat', () => {
    const r = detectIntent('/chat hello world');
    expect(r.type).toBe('chat');
    if (r.type === 'chat') expect(r.input).toBe('hello world');
  });

  it('/clear', () => {
    expect(detectIntent('/clear').type).toBe('clear');
    expect(detectIntent('/clean').type).toBe('clear');
    expect(SLASH_COMMANDS.some((cmd) => cmd.cmd === '/clean')).toBe(true);
  });

  it('/compact', () => {
    expect(detectIntent('/compact').type).toBe('compact');
    expect(SLASH_COMMANDS.some((cmd) => cmd.cmd === '/compact')).toBe(true);
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
  it('plain text auto-classifies into code/question/ambiguous', () => {
    const fix = detectIntent('fix the login bug');
    expect(fix.type).toBe('auto');
    if (fix.type === 'auto') expect(fix.taskClass).toBe('code');

    const question = detectIntent('how do I deploy');
    expect(question.type).toBe('auto');
    if (question.type === 'auto') expect(question.taskClass).toBe('question');

    const ambiguous = detectIntent('should we use Redis');
    expect(ambiguous.type).toBe('auto');
    if (ambiguous.type === 'auto') expect(ambiguous.taskClass).toBe('ambiguous');
  });

  it('dispatches an explicit "review with <known engine>" from chat', () => {
    const r = detectIntent('review with claude');
    expect(r.type).toBe('review');

    const branch = detectIntent('review branch:main with claude');
    expect(branch.type).toBe('review');
    if (branch.type === 'review') expect(branch.target).toBe('branch:main');
  });

  it('dispatches plain multi-engine "review with <engines>" from chat', () => {
    const r = detectIntent('review with codex claude');
    expect(r.type).toBe('review');
    if (r.type === 'review') expect(r.engineIds).toEqual(['codex', 'claude']);

    // unknown engine token ("gemini" is now "agy") → not a dispatch, stays auto
    expect(detectIntent('review with gemini').type).toBe('auto');
  });

  it('does not short-circuit compound instructions starting with implementation verbs', () => {
    const fixThenReview = detectIntent('fix auth then review with codex');
    expect(fixThenReview.type).not.toBe('review');

    const fixingThenReview = detectIntent('fixing auth now, ask codex to review it');
    expect(fixingThenReview.type).not.toBe('review');

    const createdThenReview = detectIntent('created auth wiring, review it with codex');
    expect(createdThenReview.type).not.toBe('review');

    const pleaseFix = detectIntent('please fix auth then review with codex');
    expect(pleaseFix.type).not.toBe('review');

    const canYouFix = detectIntent('can you fix auth then review with codex');
    expect(canYouFix.type).not.toBe('review');
  });

  it('dispatches explicit review delegation text from chat (with known engines)', () => {
    const r = detectIntent('review it with codex');
    expect(r.type).toBe('review');

    const withAnd = detectIntent('review it with codex and claude');
    expect(withAnd.type).toBe('review');
    if (withAnd.type === 'review') expect(withAnd.engineIds).toEqual(['codex', 'claude']);

    const ask = detectIntent('ask codex and claude to review it');
    expect(ask.type).toBe('review');

    const canYou = detectIntent('can you review with claude and codex');
    expect(canYou.type).toBe('review');
  });

  it('keeps collaboration phrases as auto; slash commands are required for buddy flows', () => {
    const brainstorm = detectIntent('can you ask others whether this design is good');
    expect(brainstorm.type).toBe('auto');

    const tribunal = detectIntent('debate whether REST or GraphQL fits');
    expect(tribunal.type).toBe('auto');

    const campfire = detectIntent('talk this through with the team');
    expect(campfire.type).toBe('auto');
  });

  it('does not misroute feature requests that mention engines to brainstorm', () => {
    const r = detectIntent('can you make Agon feel alive with real-time engine telemetry, CPU and memory per engine, a /status dashboard, fallback on stalls, keep it in KERN, spec first then build');
    expect(r.type).toBe('auto');
    if (r.type === 'auto') {
      expect(r.input).toContain('real-time engine telemetry');
    }
  });

  it('keeps competition phrases as auto; /forge is required', () => {
    const r = detectIntent('make engines compete on fix auth test with npm test');
    expect(r.type).toBe('auto');
  });

  it('keeps explicit natural-language forge imperatives as auto', () => {
    const r = detectIntent('can you Forge a small CLI UX fix: make forge status labels show synthesizing before final patch review. Fitness: npm run test:ts -- tests/unit/forge-timeout.test.ts tests/integration/forge-e2e.test.ts');
    expect(r.type).toBe('auto');
  });

  it('keeps natural-language forge prompts as auto even without fitness', () => {
    const r = detectIntent('forge a small CLI UX fix for forge status labels');
    expect(r.type).toBe('auto');
  });

  it('does not treat forge status questions as forge jobs', () => {
    const r = detectIntent('forge is still stuck, why?');
    expect(r.type).toBe('auto');
  });

  it('parses explicit natural-language agent shortcuts without waiting for Cesar', () => {
    const direct = detectIntent('agent fix paste handling and run tests');
    expect(direct.type).toBe('agent');
    if (direct.type === 'agent') expect(direct.input).toBe('fix paste handling and run tests');

    const mode = detectIntent('agent mode inspect the auth flow');
    expect(mode.type).toBe('agent');
    if (mode.type === 'agent') expect(mode.input).toBe('inspect the auth flow');

    const autonomous = detectIntent('autonomous agent update the docs');
    expect(autonomous.type).toBe('agent');
    if (autonomous.type === 'agent') expect(autonomous.input).toBe('update the docs');
  });

  it('leaves natural-language review requests to Cesar', () => {
    const r = detectIntent('review this code for subtle bugs');
    expect(r.type).toBe('auto');
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

  it('ambiguous input returns auto with ambiguous class', () => {
    const r = detectIntent('hello there');
    expect(r.type).toBe('auto');
    if (r.type === 'auto') expect(r.taskClass).toBe('ambiguous');
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

describe('Intent Detection — natural-language review dispatch (no slash)', () => {
  it('dispatches "review with <engines>" deterministically, target defaults to uncommitted', () => {
    const r = detectIntent('review with codex claude agy');
    expect(r.type).toBe('review');
    if (r.type === 'review') {
      expect(r.engineIds).toEqual(['codex', 'claude', 'agy']);
      expect(r.target).toBeUndefined(); // → uncommitted downstream
    }
  });

  it('tolerates a politeness prefix and "and"-joined engines', () => {
    const r = detectIntent('can you review with codex claude and agy');
    expect(r.type).toBe('review');
    if (r.type === 'review') {
      expect(r.engineIds).toEqual(['codex', 'claude', 'agy']);
    }
  });

  it('honours an explicit target in a chat request', () => {
    const r = detectIntent('review branch:main with codex');
    expect(r.type).toBe('review');
    if (r.type === 'review') {
      expect(r.engineIds).toEqual(['codex']);
      expect(r.target).toBe('branch:main');
    }
  });

  it('does NOT hijack prose that merely mentions review (→ Cesar)', () => {
    expect(detectIntent('review this code').type).not.toBe('review');
    expect(detectIntent('can you review whether this approach is correct').type).not.toBe('review');
    // "with" but no known engine names → not a dispatch
    expect(detectIntent('review with me the options').type).not.toBe('review');
  });

  it('does NOT hijack compound "fix then review" (→ Cesar handles the sequence)', () => {
    expect(detectIntent('fix the bug then review with codex').type).not.toBe('review');
  });
});

describe('/permissions rule editing', () => {
  it('parses the bare listing form', () => {
    expect(detectIntent('/permissions')).toMatchObject({ type: 'permissions' });
    expect(detectIntent('/perms')).toMatchObject({ type: 'permissions' });
  });

  it('parses add allow/deny with the rule preserved verbatim', () => {
    expect(detectIntent('/permissions add allow Bash(git push:*)')).toMatchObject({
      type: 'permissions', action: 'add', key: 'allow', value: 'Bash(git push:*)',
    });
    expect(detectIntent('/permissions add deny Bash(rm:*)')).toMatchObject({
      type: 'permissions', action: 'add', key: 'deny', value: 'Bash(rm:*)',
    });
  });

  it('parses remove', () => {
    expect(detectIntent('/permissions remove Bash(git push:*)')).toMatchObject({
      type: 'permissions', action: 'remove', value: 'Bash(git push:*)',
    });
  });

  it('falls back to listing on malformed subcommands', () => {
    expect(detectIntent('/permissions add Bash(git push:*)')).toMatchObject({ type: 'permissions' });
    expect((detectIntent('/permissions add Bash(git push:*)') as any).action).toBeUndefined();
  });
});
