import { describe, expect, it } from 'vitest';
import {
  createCesarRecapCapture,
  recordCesarRecapEvent,
  buildCesarTurnRecapEvent,
  shouldEmitCesarRecap,
  classifyConsequence,
  formatCesarRecapToolSummary,
} from '../../packages/cli/src/generated/cesar/recap.js';

const bashCall = (command: string, status: string, output = '') => ({
  type: 'tool-call' as const,
  tool: 'Bash',
  input: JSON.stringify({ command }),
  status,
  output,
});

describe('formatCesarRecapToolSummary', () => {
  it('keeps the full tool count while bounding labels to eight', () => {
    const tools = Array.from({ length: 10 }, (_, index) => `Tool${index + 1}`);
    expect(formatCesarRecapToolSummary(14, tools)).toBe(
      '14 tools: Tool1, Tool2, Tool3, Tool4, Tool5, Tool6, Tool7, Tool8, ...',
    );
  });
});

describe('shouldEmitCesarRecap — turn-recap skip gate', () => {
  const base = {
    type: 'cesar-recap',
    engineId: 'claude',
    mode: 'self',
    outcome: 'Completed',
    durationMs: 1000,
    toolCount: 0,
    failedTools: 0,
    toolSummary: [] as string[],
    commands: [] as any[],
    files: [] as any[],
    changeSummary: { created: 0, edited: 0, read: 0 },
    todos: null as any,
    warnings: [] as string[],
  };

  it('rejects non-recap events', () => {
    expect(shouldEmitCesarRecap({ type: 'text' })).toBe(false);
    expect(shouldEmitCesarRecap(null)).toBe(false);
  });

  it('always emits a delegation hand-off', () => {
    expect(shouldEmitCesarRecap({ ...base, outcome: 'Handed off to forge', confidence: null })).toBe(true);
  });

  it('SKIPS a bare ReportConfidence turn (toolCount 1, confidence set, no findings)', () => {
    // Exactly the trivial turn the spec calls out: one Confidence tool call, a
    // confidence number, nothing else. Must stay quiet.
    const recap = { ...base, toolCount: 1, confidence: 92, toolSummary: ['Confidence'] };
    expect(shouldEmitCesarRecap(recap)).toBe(false);
  });

  it('SKIPS a no-tool, confidence-only turn', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 0, confidence: 80 })).toBe(false);
  });

  it('SKIPS a single silent read with no findings', () => {
    const recap = { ...base, toolCount: 1, confidence: null, files: [{ path: 'a.ts', relPath: 'a.ts', status: 'read', touchCount: 1 }] };
    expect(shouldEmitCesarRecap(recap)).toBe(false);
  });

  it('emits when more than one tool call ran (real work, even read-only)', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 3, confidence: 90 })).toBe(true);
  });

  it('emits when a file was changed (finding) even on a single tool call', () => {
    const recap = { ...base, toolCount: 1, files: [{ path: 'a.ts', relPath: 'a.ts', status: 'edited', touchCount: 1 }] };
    expect(shouldEmitCesarRecap(recap)).toBe(true);
  });

  it('emits when a verification (build/test) ran', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 1, verification: [{ label: 'tests', ok: true }] })).toBe(true);
  });

  it('SKIPS a lone plumbing command (git status) with nothing else — no actionable row', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 1, commands: [{ label: 'git status', command: 'git status', status: 'done' }] })).toBe(false);
  });

  it('emits a genuinely failed turn even with no other findings', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 1, failed: true })).toBe(true);
  });

  it('emits when an unrecovered consequential failure is present', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 1, failureLines: [{ action: 'commit', command: 'git commit', reason: 'x' }] })).toBe(true);
  });

  it('emits when warnings/errors were raised', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 0, warnings: ['something went wrong'] })).toBe(true);
  });

  it('emits when the turn made todo progress (finding) even with one tool call', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 1, todos: { done: 1, total: 3 } })).toBe(true);
  });
});

describe('buildCesarTurnRecapEvent — todo delta capture', () => {
  it('captures the latest todos-set snapshot as N/M done', () => {
    const capture = createCesarRecapCapture('do stuff', Date.now());
    recordCesarRecapEvent(capture, {
      type: 'todos-set',
      todos: [
        { id: '1', text: 'a', state: 'done' },
        { id: '2', text: 'b', state: 'done' },
        { id: '3', text: 'c', state: 'running' },
      ],
    });
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.todos).toEqual({ done: 2, total: 3 });
  });

  it('latest todos-set wins (the brain re-emits the whole block)', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, { type: 'todos-set', todos: [{ id: '1', text: 'a', state: 'running' }] });
    recordCesarRecapEvent(capture, {
      type: 'todos-set',
      todos: [{ id: '1', text: 'a', state: 'done' }, { id: '2', text: 'b', state: 'done' }],
    });
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.todos).toEqual({ done: 2, total: 2 });
  });

  it('counts cancelled todos as resolved (done)', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, {
      type: 'todos-set',
      todos: [{ id: '1', text: 'a', state: 'done' }, { id: '2', text: 'b', state: 'cancelled' }],
    });
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.todos).toEqual({ done: 2, total: 2 });
  });

  it('a todos-clear wipes the captured snapshot (todos: null)', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, { type: 'todos-set', todos: [{ id: '1', text: 'a', state: 'running' }] });
    recordCesarRecapEvent(capture, { type: 'todos-clear', scope: 'live' });
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.todos).toBeNull();
  });

  it('no todos declared → todos is null (renderer omits the line)', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.todos).toBeNull();
  });
});

describe('classifyConsequence — consequential vs plumbing', () => {
  it('treats navigation/inspection/staging/probes as plumbing (null)', () => {
    for (const cmd of ['cd /foo', 'ls -la', 'echo hi', 'cat x.ts', 'pwd', 'mkdir d', 'git status', 'git add -A', 'git diff', 'git log --oneline', 'node --check x.js', 'command -v foo']) {
      expect(classifyConsequence('Bash', cmd)).toBeNull();
    }
  });

  it('treats empty / malformed tool calls as plumbing (null)', () => {
    expect(classifyConsequence('Bash', '{}')).toBeNull();
    expect(classifyConsequence('Bash', '')).toBeNull();
    expect(classifyConsequence('Bash', '   ')).toBeNull();
  });

  it('only classifies bash-family tools — reads/edits/searches are null', () => {
    expect(classifyConsequence('Read', 'git commit -m x')).toBeNull();
    expect(classifyConsequence('Edit', 'anything')).toBeNull();
    expect(classifyConsequence('Search', 'git push')).toBeNull();
  });

  it('maps recognized consequential commands to a typed FinalAction', () => {
    expect(classifyConsequence('Bash', 'git commit -m "x"')).toBe('commit');
    expect(classifyConsequence('Bash', 'cd /r && git push origin main')).toBe('push');
    expect(classifyConsequence('Bash', 'npm run build')).toBe('build');
    expect(classifyConsequence('Bash', 'npm run typecheck')).toBe('typecheck');
    expect(classifyConsequence('Bash', 'npm test')).toBe('tests');
    expect(classifyConsequence('Bash', 'npm run lint')).toBe('lint');
    expect(classifyConsequence('Bash', 'npm run kern:compile')).toBe('compile');
  });

  it('FAILS OPEN: an unrecognized non-plumbing command is consequential (run), never swallowed', () => {
    expect(classifyConsequence('Bash', 'curl https://example.com')).toBe('run');
    expect(classifyConsequence('Bash', 'rm -rf build')).toBe('run');
    expect(classifyConsequence('Bash', './my-custom-deploy.sh')).toBe('run');
  });

  it('recognizes a consequential action CHAINED after cd/staging (the real screenshot shape)', () => {
    // Regression: a leading `cd …` must NOT mask the commit/push that follows.
    expect(classifyConsequence('Bash', 'cd /repo && git add -A && git commit -m "x"')).toBe('commit');
    expect(classifyConsequence('Bash', 'cd /repo && git push origin main')).toBe('push');
    // …but a pure cd + inspection chain is still plumbing.
    expect(classifyConsequence('Bash', 'cd /repo && git status --short')).toBeNull();
    expect(classifyConsequence('Bash', 'cd /repo && git add -A')).toBeNull();
  });

  it('FAILS OPEN for an UNKNOWN action chained after plumbing (codex finding)', () => {
    // The leading plumbing step must not swallow an unrecognized consequential
    // one — these would otherwise be hidden as non-fatal noise.
    expect(classifyConsequence('Bash', 'cd /repo && ./deploy.sh')).toBe('run');
    expect(classifyConsequence('Bash', 'git add -A && ./release.sh')).toBe('run');
  });

  it('does NOT fragment a single plumbing command on a pipe inside its args', () => {
    // Splitting on a bare `|` would turn `grep -E "a|b"` into a fail-open red line
    // on a benign no-match exit — exactly the noise we are removing.
    expect(classifyConsequence('Bash', "grep -E 'foo|bar' file.ts")).toBeNull();
    expect(classifyConsequence('Bash', 'cat x.json | grep build')).toBeNull();
    // …but a real action piped into plumbing is still caught.
    expect(classifyConsequence('Bash', 'npm test | tee out.log')).toBe('tests');
  });

  it('does NOT read an action mentioned inside a string-arg command (echo/grep/cat)', () => {
    // The argument is DATA, not a sub-command — a quoted/searched action name must
    // not promote a benign echo/grep failure to a red ✗ line.
    expect(classifyConsequence('Bash', "echo 'git commit done'")).toBeNull();
    expect(classifyConsequence('Bash', "grep -r 'kern:compile' src")).toBeNull();
    expect(classifyConsequence('Bash', "find . -name '*.test.ts'")).toBeNull();
  });

  it('does NOT split on a single & so shell redirections stay intact (codex finding)', () => {
    // Splitting on `&` would fragment `2>&1` / `&>` and turn benign plumbing into
    // a fail-open red line — the original node --check noise we are removing.
    expect(classifyConsequence('Bash', 'node --check renderer.js 2>&1')).toBeNull();
    expect(classifyConsequence('Bash', 'cat build.log 2>&1')).toBeNull();
    expect(classifyConsequence('Bash', 'npm run build > out.log 2>&1')).toBe('build');
    // A consequential action backgrounded after & is still caught by the
    // anywhere-matching specific check.
    expect(classifyConsequence('Bash', 'git add -A & git commit -m x')).toBe('commit');
  });

  it('recognizes npm run test (not just npm test)', () => {
    expect(classifyConsequence('Bash', 'npm run test')).toBe('tests');
  });
});

describe('buildCesarTurnRecapEvent — failure surfacing & headline status', () => {
  it('keeps null confidence absent while preserving an explicit zero', () => {
    const missing = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(missing, { type: 'confidence-update', value: null });
    expect(buildCesarTurnRecapEvent(missing, { responded: true }, [], []).confidence).toBeNull();

    const zero = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(zero, { type: 'confidence-update', value: 0 });
    expect(buildCesarTurnRecapEvent(zero, { responded: true }, [], []).confidence).toBe(0);
  });

  it('treats policy-skipped checks as neutral and later executed successes as final truth', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    for (const command of [
      'npm run kern:compile 2>&1 | tail -20',
      'npm run build 2>&1 | tail -15',
      'npm run typecheck 2>&1 | tail -15',
    ]) {
      recordCesarRecapEvent(capture, {
        ...bashCall(command, 'error', '[Investigation phase] Bash command skipped — mutating commands available after confidence check.'),
        toolCallId: `skip-${command}`,
        terminalReason: 'skipped_policy',
      });
    }
    for (const command of ['npm run kern:compile', 'npm run build', 'npm run typecheck']) {
      recordCesarRecapEvent(capture, {
        ...bashCall(command, 'done', 'ok'),
        toolCallId: `pass-${command}`,
        terminalReason: 'succeeded',
      });
    }

    const recap = buildCesarTurnRecapEvent(capture, { responded: true, terminalState: 'completed' }, [], []);
    expect(recap.outcome).toBe('Done');
    expect(recap.failedTools).toBe(0);
    expect(recap.skippedTools).toBe(3);
    expect(recap.failureLines).toEqual([]);
    expect(recap.verification).toEqual([
      { label: 'compile', ok: true, state: 'passed' },
      { label: 'build', ok: true, state: 'passed' },
      { label: 'typecheck', ok: true, state: 'passed' },
    ]);
  });

  it('reconciles equivalent verification commands by logical label', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, { ...bashCall('npm run build --silent', 'error', 'boom'), toolCallId: 'build-1', terminalReason: 'failed' });
    recordCesarRecapEvent(capture, { ...bashCall('npm run build', 'done', 'ok'), toolCallId: 'build-2', terminalReason: 'succeeded' });
    const recap = buildCesarTurnRecapEvent(capture, { responded: true, terminalState: 'completed' }, [], []);
    expect(recap.failureLines).toEqual([]);
    expect(recap.failedTools).toBe(0);
    expect(recap.verification).toEqual([{ label: 'build', ok: true, state: 'passed' }]);
  });

  it('treats a later successful retry as final truth for consequential commands', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, { ...bashCall('./deploy.sh', 'error', 'temporary failure'), toolCallId: 'deploy-1', terminalReason: 'failed' });
    recordCesarRecapEvent(capture, { ...bashCall('./deploy.sh', 'done', 'deployed'), toolCallId: 'deploy-2', terminalReason: 'succeeded' });

    const recap = buildCesarTurnRecapEvent(capture, { responded: true, terminalState: 'completed' }, [], []);
    expect(recap.failureLines).toEqual([]);
    expect(recap.failedTools).toBe(0);
  });

  it('does not invent success for a non-terminal running tool event', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, {
      ...bashCall('npm run build', 'running', ''),
      toolCallId: 'build-running',
    });

    const recap = buildCesarTurnRecapEvent(capture, { responded: false, terminalState: 'failed' }, [], []);
    expect(recap.verification).toEqual([]);
    expect(recap.failedTools).toBe(0);
  });

  it('counts a failed non-command tool without crashing and forces a recap', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, {
      type: 'tool-call', tool: 'Read', input: 'missing.ts', status: 'error',
      output: 'Error: missing', toolCallId: 'read-1', terminalReason: 'failed',
    });

    const recap = buildCesarTurnRecapEvent(capture, { responded: true, terminalState: 'completed' }, [], []);
    expect(recap.failedTools).toBe(1);
    expect(recap.nonFatalCount).toBe(1);
    expect(recap.failureLines).toEqual([]);
    expect(recap.failed).toBe(false);
    expect(recap.outcome).toBe('Done');
    expect(shouldEmitCesarRecap(recap)).toBe(true);
  });

  it('marks a failed write tool as Failed even without a command-shaped input', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, {
      type: 'tool-call', tool: 'Edit', input: { file_path: 'src/app.ts' }, status: 'error',
      output: 'old_string not found', toolCallId: 'edit-1', terminalReason: 'failed',
    });

    const recap = buildCesarTurnRecapEvent(capture, { responded: true, terminalState: 'completed' }, [], []);
    expect(recap.failedTools).toBe(1);
    expect(recap.nonFatalCount).toBe(0);
    expect(recap.failed).toBe(true);
    expect(recap.outcome).toBe('Failed');
  });

  it('uses the completed streamed input for a correlated tool call', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, { type: 'tool-call', tool: 'Bash', input: '', status: 'running', toolCallId: 'bash-1' });
    recordCesarRecapEvent(capture, { type: 'tool-call', tool: 'Bash', input: '{"command":"npm test"}', status: 'done', output: 'ok', toolCallId: 'bash-1', terminalReason: 'succeeded' });

    const recap = buildCesarTurnRecapEvent(capture, { responded: true, terminalState: 'completed' }, [], []);
    expect(recap.commands[0].command).toContain('npm test');
  });

  it('records a streamed eager tool terminal event as the correlated final result', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, {
      type: 'tool-call', tool: 'Bash', input: '{"command":"npm test"}',
      status: 'running', toolCallId: 'bash-streamed',
    });
    recordCesarRecapEvent(capture, {
      type: 'tool-stream-end', streamId: 'eager-stream-bash-streamed',
      tool: 'Bash', input: '{"command":"npm test"}', status: 'done', output: 'passed',
      toolCallId: 'bash-streamed', terminalReason: 'succeeded',
    });

    const recap = buildCesarTurnRecapEvent(capture, { responded: true, terminalState: 'completed' }, [], []);
    expect(recap.failedTools).toBe(0);
    expect(recap.verification).toEqual([{ label: 'tests', ok: true, state: 'passed' }]);
    expect(recap.commands[0]).toMatchObject({ status: 'done', terminalReason: 'succeeded' });
  });

  it('hydrates an uncorrelated stream end from its stream start contract', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, {
      type: 'tool-stream-start', streamId: 'stream-contract', engineId: 'cesar',
      tool: 'Bash', input: '{"command":"npm test"}',
    });
    // tool/input/toolCallId are optional on OutputEvent.tool-stream-end. The
    // streamId must therefore be sufficient to retain the start metadata.
    recordCesarRecapEvent(capture, {
      type: 'tool-stream-end', streamId: 'stream-contract', status: 'done',
      output: 'passed', terminalReason: 'succeeded',
    });

    const recap = buildCesarTurnRecapEvent(capture, { responded: true, terminalState: 'completed' }, [], []);
    expect(recap.toolCount).toBe(1);
    expect(recap.verification).toEqual([{ label: 'tests', ok: true, state: 'passed' }]);
    expect(recap.commands[0]).toMatchObject({ status: 'done', terminalReason: 'succeeded' });
  });

  it('correlates prototype-like stream IDs without mutating object prototypes', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, {
      type: 'tool-stream-start', streamId: '__proto__', engineId: 'cesar',
      tool: 'Bash', input: '{"command":"npm test"}',
    });
    recordCesarRecapEvent(capture, {
      type: 'tool-stream-end', streamId: '__proto__', status: 'done',
      output: 'passed', terminalReason: 'succeeded',
    });

    const recap = buildCesarTurnRecapEvent(capture, { responded: true, terminalState: 'completed' }, [], []);
    expect(recap.verification).toEqual([{ label: 'tests', ok: true, state: 'passed' }]);
    expect(Object.getPrototypeOf(capture.toolStreamsById)).toBe(Object.prototype);
  });

  it('marks an unrecovered consequential failure red while keeping non-command failures non-fatal', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, bashCall('git commit -m "x"', 'error', 'nothing to commit'));
    const consequential = buildCesarTurnRecapEvent(capture, { responded: true, terminalState: 'completed' }, [], []);
    expect(consequential.failed).toBe(true);
    expect(consequential.outcome).toBe('Failed');

    const nonFatal = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(nonFatal, {
      type: 'tool-call', tool: 'Read', input: 'missing.ts', status: 'error',
      output: 'missing', toolCallId: 'read-nonfatal', terminalReason: 'failed',
    });
    expect(buildCesarTurnRecapEvent(nonFatal, { responded: true, terminalState: 'completed' }, [], []).failed).toBe(false);
    expect(buildCesarTurnRecapEvent(capture, { responded: false }, [], []).failed).toBe(true);
  });

  it('renders a no-output timeout as an amber partial result, not a red failure', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    const recap = buildCesarTurnRecapEvent(
      capture,
      { responded: false, terminalState: 'timed_out' },
      [],
      [],
    );
    expect(recap.outcome).toBe('Partial');
    expect(recap.failed).toBe(false);
  });

  it('promotes an unrecovered CONSEQUENTIAL failure to a red failure line with reason', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, bashCall('git commit -m "x"', 'error', 'nothing to commit, working tree clean'));
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.failureLines).toHaveLength(1);
    expect(recap.failureLines[0].action).toBe('commit');
    expect(recap.failureLines[0].reason).toContain('nothing to commit');
    expect(recap.nonFatalCount).toBe(0);
  });

  it('folds a PLUMBING failure into the non-fatal count, no red line', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, bashCall('node --check renderer.js', 'error', 'SyntaxError'));
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.failureLines).toHaveLength(0);
    expect(recap.failedTools).toBe(0);
    expect(recap.nonFatalCount).toBe(1);
    expect(recap.failed).toBe(false);
    expect(shouldEmitCesarRecap(recap)).toBe(false);
  });

  it('a recovered failure (exact retry later succeeded) is neither a red line nor counted', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, bashCall('npm run build', 'error', 'boom'));
    recordCesarRecapEvent(capture, bashCall('npm run build', 'done', 'ok'));
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.failureLines).toHaveLength(0);
    expect(recap.failedTools).toBe(0);
    expect(recap.nonFatalCount).toBe(0);
  });

  it('caps red failure lines at 3 with an overflow count; non-fatal stays clean', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    for (const c of ['git commit -m a', 'git push origin a', 'npm run build', 'npm test']) {
      recordCesarRecapEvent(capture, bashCall(c, 'error', 'fail'));
    }
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.failureLines).toHaveLength(3);
    expect(recap.failureOverflow).toBe(1);
    expect(recap.nonFatalCount).toBe(0);
  });

  it('excludes the benign auto-continue nudge from the recap warnings', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, { type: 'warning', message: 'Cesar paused mid-task — auto-continuing (1/5).' });
    recordCesarRecapEvent(capture, { type: 'warning', message: 'a real problem surfaced' });
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.warnings).toContain('a real problem surfaced');
    expect(recap.warnings.some((w: string) => /auto-continuing/.test(w))).toBe(false);
  });
});
