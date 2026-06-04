import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCesarTurnId,
  recordCesarApprovalDecision,
  recordCesarToolTimeline,
  recordCesarConfidence,
  buildToolErrorDiagnostic,
  replayCesarHarnessLogs,
} from '../../packages/cli/src/generated/cesar/tool-observability.js';
import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

describe('Cesar tool observability', () => {
  it('records approval decisions without full edit contents', () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'agon-approval-ledger-'));

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
    const runsDir = mkdtempSync(join(tmpdir(), 'agon-tool-timeline-'));
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
    const runsDir = mkdtempSync(join(tmpdir(), 'agon-tool-command-redaction-'));

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
    const runsDir = mkdtempSync(join(tmpdir(), 'agon-tool-replay-'));
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
