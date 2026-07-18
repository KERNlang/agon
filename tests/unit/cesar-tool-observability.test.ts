import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCesarTurnId,
  recordCesarApprovalDecision,
  recordCesarToolTimeline,
  recordCesarConfidence,
  buildToolErrorDiagnostic,
  replayCesarHarnessLogs,
  classifyCesarToolEffect,
} from '../../packages/cli/src/generated/cesar/tool-observability.js';
import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

describe('Cesar tool observability', () => {
  const tempDirs: string[] = [];
  const makeTempDir = (prefix: string): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records approval decisions without full edit contents', () => {
    const runsDir = makeTempDir('agon-approval-ledger-');

    recordCesarApprovalDecision({
      turnId: 'turn-1',
      engineId: 'cesar',
      cwd: '/repo',
      tool: 'Edit',
      decision: 'approved',
      source: 'cesar-self-turn',
      reason: 'bounded edit',
      path: '/repo/src.ts',
      args: {
        file_path: '/repo/src.ts',
        old_string: 'const secret = 1;',
        new_string: 'const secret = 2;',
      },
    }, runsDir);

    const line = readFileSync(join(runsDir, 'cesar-approval-ledger.jsonl'), 'utf-8').trim();
    const record = JSON.parse(line);

    expect(record.kind).toBe('approval_decision');
    expect(record.decision).toBe('approved');
    expect(record.args.file_path).toBe('/repo/src.ts');
    expect(record.args.old_string).toMatchObject({ redacted: true, chars: 17 });
    expect(record.args.new_string).toMatchObject({ redacted: true, chars: 17 });
  });

  it('records compact tool timeline events', () => {
    const runsDir = makeTempDir('agon-tool-timeline-');
    const turnId = createCesarTurnId();

    recordCesarToolTimeline({
      turnId,
      event: 'tool_result',
      engineId: 'cesar',
      cwd: '/repo',
      tool: 'Read',
      source: 'xml',
      status: 'ok',
      input: { file_path: 'src.ts' },
      output: 'x'.repeat(300),
    }, runsDir);

    const line = readFileSync(join(runsDir, 'cesar-tool-timeline.jsonl'), 'utf-8').trim();
    const record = JSON.parse(line);

    expect(record.turnId).toBe(turnId);
    expect(record.event).toBe('tool_result');
    expect(record.input.file_path).toBe('src.ts');
    expect(record.output).toMatchObject({ redacted: true, chars: 300 });
  });

  it('redacts command strings instead of persisting command previews', () => {
    const runsDir = makeTempDir('agon-tool-command-redaction-');

    recordCesarToolTimeline({
      turnId: 'turn-command',
      event: 'tool_call',
      engineId: 'cesar',
      cwd: '/repo',
      tool: 'Bash',
      source: 'native',
      status: 'running',
      input: 'OPENAI_API_KEY=sk-testsecret npm test',
    }, runsDir);

    const line = readFileSync(join(runsDir, 'cesar-tool-timeline.jsonl'), 'utf-8').trim();
    const record = JSON.parse(line);

    expect(record.input.commandBase).toBe('[redacted-command]');
    expect(record.input.redactedPreview).toBe(true);
    expect(record.input.commandPreview).toBeUndefined();
  });

  it('replays timeline and approval records by turn', () => {
    const runsDir = makeTempDir('agon-tool-replay-');
    const turnId = 'turn-replay-1';

    recordCesarToolTimeline({
      turnId,
      event: 'turn_start',
      engineId: 'cesar',
      cwd: '/repo',
      status: 'running',
      summary: { inputChars: 12 },
    }, runsDir);
    recordCesarToolTimeline({
      turnId,
      event: 'tool_call',
      engineId: 'cesar',
      cwd: '/repo',
      tool: 'Read',
      source: 'xml',
      status: 'running',
      input: { file_path: 'src.ts' },
    }, runsDir);
    recordCesarApprovalDecision({
      turnId,
      engineId: 'cesar',
      cwd: '/repo',
      tool: 'Edit',
      decision: 'approved',
      source: 'cesar-self-turn',
      reason: 'bounded edit',
      path: '/repo/src.ts',
      args: { file_path: '/repo/src.ts', old_string: 'a', new_string: 'b' },
    }, runsDir);

    const replay = replayCesarHarnessLogs({ runsDir, turnId });

    expect(replay.turnCount).toBe(1);
    expect(replay.approvalCount).toBe(1);
    expect(replay.rendered).toContain('Turn turn-replay-1');
    expect(replay.rendered).toContain('tools: Read');
    expect(replay.rendered).toContain('approval: Edit approved via cesar-self-turn');
  });

  describe('effect-class ledger split', () => {
    it('classifies tool effects: write tools, bash read/write split, plain reads', () => {
      expect(classifyCesarToolEffect('Edit', { file_path: 'a.ts' })).toBe('write');
      expect(classifyCesarToolEffect('Write', { file_path: 'a.ts' })).toBe('write');
      expect(classifyCesarToolEffect('AgonWrite', { file_path: 'a.ts' })).toBe('write');
      expect(classifyCesarToolEffect('MultiEdit', { file_path: 'a.ts' })).toBe('write');
      expect(classifyCesarToolEffect('Read', { file_path: 'a.ts' })).toBe('read');
      expect(classifyCesarToolEffect('Grep', { pattern: 'x' })).toBe('read');
      expect(classifyCesarToolEffect('Bash', { command: 'git status' })).toBe('bash-read');
      expect(classifyCesarToolEffect('Bash', { command: 'npm test' })).toBe('bash-read');
      expect(classifyCesarToolEffect('Bash', { command: 'npm install express' })).toBe('bash-write');
      expect(classifyCesarToolEffect('Bash', { command: 'rm -rf build' })).toBe('bash-write');
      expect(classifyCesarToolEffect('Bash', 'git diff --stat')).toBe('bash-read');
      expect(classifyCesarToolEffect(undefined, undefined)).toBeUndefined();
    });

    it('unwraps JSON-encoded Bash inputs (the native stream path shape)', () => {
      expect(classifyCesarToolEffect('Bash', '{"command":"git status"}')).toBe('bash-read');
      expect(classifyCesarToolEffect('Bash', '{"command":"rm -rf build"}')).toBe('bash-write');
      // Unparseable/command-less JSON fails closed to bash-write, never read.
      expect(classifyCesarToolEffect('Bash', '{"cwd":"/repo"}')).toBe('bash-write');
      expect(classifyCesarToolEffect('Bash', '{broken json')).toBe('bash-write');
    });

    it('returns undefined for unknown-effect tools instead of stamping them read', () => {
      expect(classifyCesarToolEffect('SaveMemory', { text: 'note' })).toBeUndefined();
      expect(classifyCesarToolEffect('Agent', { prompt: 'go' })).toBeUndefined();
      expect(classifyCesarToolEffect('mcp__custom__deploy', {})).toBeUndefined();
    });

    it('stamps the effect class onto timeline records at write time', () => {
      const runsDir = makeTempDir('agon-tool-effect-stamp-');

      recordCesarToolTimeline({
        turnId: 'turn-effect',
        event: 'tool_call',
        tool: 'Edit',
        input: { file_path: 'src.ts', old_string: 'a', new_string: 'b' },
      }, runsDir);
      recordCesarToolTimeline({
        turnId: 'turn-effect',
        event: 'tool_call',
        tool: 'Bash',
        input: { command: 'git status' },
      }, runsDir);
      recordCesarToolTimeline({
        turnId: 'turn-effect',
        event: 'tool_call',
        tool: 'Read',
        input: { file_path: 'src.ts' },
      }, runsDir);

      const lines = readFileSync(join(runsDir, 'cesar-tool-timeline.jsonl'), 'utf-8').trim().split('\n');
      const effects = lines.map((l) => JSON.parse(l).effect);
      expect(effects).toEqual(['write', 'bash-read', 'read']);
    });

    it('splits mutating vs read-only counts over successful results and lists writes in replay', () => {
      const runsDir = makeTempDir('agon-tool-effect-replay-');
      const turnId = 'turn-effect-replay';

      recordCesarToolTimeline({ turnId, event: 'turn_start', status: 'running' }, runsDir);
      // Running rows (tool_call) are attempts and must not be counted.
      recordCesarToolTimeline({ turnId, event: 'tool_call', tool: 'Edit', status: 'running', input: { file_path: 'a.ts' } }, runsDir);
      recordCesarToolTimeline({ turnId, event: 'tool_result', tool: 'Read', status: 'done', input: { file_path: 'a.ts' } }, runsDir);
      recordCesarToolTimeline({ turnId, event: 'tool_result', tool: 'Grep', status: 'ok', input: { pattern: 'x' } }, runsDir);
      recordCesarToolTimeline({ turnId, event: 'tool_result', tool: 'Bash', status: 'done', input: { command: 'git status' } }, runsDir);
      recordCesarToolTimeline({ turnId, event: 'tool_result', tool: 'Edit', status: 'done', input: { file_path: 'a.ts' } }, runsDir);
      recordCesarToolTimeline({ turnId, event: 'tool_result', tool: 'Bash', status: 'done', input: { command: 'npm install express' } }, runsDir);
      // A failed write is an attempt, not a mutation — surfaced separately.
      recordCesarToolTimeline({ turnId, event: 'tool_result', tool: 'Write', status: 'error', input: { file_path: 'b.ts' } }, runsDir);

      const replay = replayCesarHarnessLogs({ runsDir, turnId });
      const turn = replay.turns[0] as any;

      expect(turn.mutationCount).toBe(2); // Edit + bash-write install (successful results only)
      expect(turn.readOnlyCount).toBe(3); // Read + Grep + bash-read git status
      expect(turn.failedMutationCount).toBe(1); // the errored Write
      expect(turn.mutatingTools).toEqual(['Edit', 'Bash']);
      expect(replay.rendered).toContain('effects: 2 mutating · 3 read-only · 1 failed mutation attempt(s)');
      expect(replay.rendered).toContain('writes: Edit, Bash');
    });

    it('treats legacy records without an effect stamp as neither mutating nor read-only', () => {
      const runsDir = makeTempDir('agon-tool-effect-legacy-');
      const turnId = 'turn-legacy';

      // Write a raw record with no effect field (simulates pre-split ledger entries).
      writeFileSync(
        join(runsDir, 'cesar-tool-timeline.jsonl'),
        JSON.stringify({ ts: new Date().toISOString(), kind: 'tool_timeline', turnId, event: 'tool_result', tool: 'Edit', status: 'done' }) + '\n',
      );

      const replay = replayCesarHarnessLogs({ runsDir, turnId });
      const turn = replay.turns[0] as any;

      expect(turn.mutationCount).toBe(0);
      expect(turn.readOnlyCount).toBe(0);
      expect(turn.mutatingTools).toEqual([]);
      expect(replay.rendered).not.toContain('writes:');
    });
  });

  describe('buildToolErrorDiagnostic (#1 error surfacing)', () => {
    it('includes the tool name, a redacted input snippet, and the error', () => {
      const diag = buildToolErrorDiagnostic('Edit', { file_path: '/x.ts', old_string: 'const secret = 1', new_string: 'const secret = 2' }, 'invalid input');
      expect(diag).toContain('Tool Edit failed');
      expect(diag).toContain('Input (redacted):');
      expect(diag).toContain('/x.ts'); // non-sensitive key survives
      expect(diag).toContain('invalid input'); // the underlying error
      expect(diag).not.toContain('const secret = 1'); // old_string redacted by summarizeToolPayload
    });

    it('caps a very large input snippet', () => {
      const many: Record<string, unknown> = {};
      for (let i = 0; i < 60; i++) many['field_number_' + i] = 'value_' + i;
      const diag = buildToolErrorDiagnostic('Write', many, 'too big');
      expect(diag).toContain('… (truncated)');
      expect(diag.length).toBeLessThan(1100);
    });

    it('falls back gracefully when the error is undefined', () => {
      const diag = buildToolErrorDiagnostic('Bash', { command: 'ls' }, undefined);
      expect(diag).toContain('Tool Bash failed');
      expect(diag).toContain('Tool execution failed');
    });

    it('reports "(no input)" when args is undefined (not an inspection failure)', () => {
      const diag = buildToolErrorDiagnostic('Read', undefined, 'boom');
      expect(diag).toContain('Input (redacted): (no input)');
      expect(diag).not.toContain('could not be inspected');
    });

    it('caps a very long error string', () => {
      const diag = buildToolErrorDiagnostic('Bash', { command: 'x' }, 'E'.repeat(900));
      expect(diag).toContain('… (truncated)');
      expect(diag.length).toBeLessThan(700);
    });

    it('coerces a non-string error defensively (no crash)', () => {
      const diag = buildToolErrorDiagnostic('Edit', { file_path: 'x' }, (new Error('boom')) as unknown as string);
      expect(diag).toContain('Tool Edit failed');
      expect(diag).toContain('boom'); // String(Error) → "Error: boom"
    });
  });

  describe('confidence ledger (#7, data-only)', () => {
    let home: string;
    beforeEach(() => { home = setupTestAgonHome('confidence-ledger'); });
    afterEach(() => { cleanupTestAgonHome(home); });

    it('appends a per-session confidence snapshot with ts and minimal fields', () => {
      recordCesarConfidence({
        sessionId: 'sess-abc',
        turnId: 'turn-7',
        engineId: 'claude',
        value: 88,
        reasoning: 'pattern is clear',
      });
      const file = agonHomePath('calibration', 'sess-abc.jsonl');
      const record = JSON.parse(readFileSync(file, 'utf-8').trim());
      expect(record.kind).toBe('confidence');
      expect(record.sessionId).toBe('sess-abc');
      expect(record.turnId).toBe('turn-7');
      expect(record.engineId).toBe('claude');
      expect(record.value).toBe(88);
      expect(record.reasoning).toBe('pattern is clear');
      expect(typeof record.ts).toBe('string'); // ISO timestamp added by the writer
      expect(Number.isNaN(Date.parse(record.ts))).toBe(false);
    });

    it('drops a snapshot with a non-finite or out-of-range value', () => {
      recordCesarConfidence({ sessionId: 'sess-bad-num', value: NaN });
      recordCesarConfidence({ sessionId: 'sess-oor', value: 150 });
      expect(existsSync(agonHomePath('calibration', 'sess-bad-num.jsonl'))).toBe(false);
      expect(existsSync(agonHomePath('calibration', 'sess-oor.jsonl'))).toBe(false);
    });

    it('redacts sensitive reasoning and caps very long reasoning', () => {
      recordCesarConfidence({ sessionId: 'sess-secret', value: 70, reasoning: 'api_key=sk-abcdef0123456789abcd found in config' });
      const secret = JSON.parse(readFileSync(agonHomePath('calibration', 'sess-secret.jsonl'), 'utf-8').trim());
      expect(secret.reasoning).toBe('[redacted]');

      recordCesarConfidence({ sessionId: 'sess-long', value: 70, reasoning: 'z'.repeat(900) });
      const long = JSON.parse(readFileSync(agonHomePath('calibration', 'sess-long.jsonl'), 'utf-8').trim());
      expect(long.reasoning.length).toBeLessThanOrEqual(520);
      expect(long.reasoning.endsWith('… (truncated)')).toBe(true);
    });

    it('sanitizes a path-traversal sessionId into a safe file name and never escapes the dir', () => {
      recordCesarConfidence({ sessionId: '../../etc/evil', value: 50 });
      // The slashes are rejected → falls back to a single safe file in the calibration dir.
      expect(existsSync(agonHomePath('calibration', 'unknown-session.jsonl'))).toBe(true);
      // And nothing escaped to the traversal target.
      expect(existsSync(agonHomePath('..', '..', 'etc', 'evil.jsonl'))).toBe(false);
      const record = JSON.parse(readFileSync(agonHomePath('calibration', 'unknown-session.jsonl'), 'utf-8').trim());
      expect(record.sessionId).toBe('unknown-session');
      expect(record.value).toBe(50);
    });
  });
});
