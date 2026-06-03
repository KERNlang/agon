import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCesarTurnId,
  recordCesarApprovalDecision,
  recordCesarToolTimeline,
  recordCesarConfidence,
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
        toolsUsedCount: 3,
      });
      const file = agonHomePath('calibration', 'sess-abc.jsonl');
      const record = JSON.parse(readFileSync(file, 'utf-8').trim());
      expect(record.kind).toBe('confidence');
      expect(record.sessionId).toBe('sess-abc');
      expect(record.turnId).toBe('turn-7');
      expect(record.engineId).toBe('claude');
      expect(record.value).toBe(88);
      expect(record.reasoning).toBe('pattern is clear');
      expect(record.toolsUsedCount).toBe(3);
      expect(typeof record.ts).toBe('string'); // ISO timestamp added by the writer
      expect(Number.isNaN(Date.parse(record.ts))).toBe(false);
    });

    it('sanitizes a path-traversal sessionId into a safe file name', () => {
      recordCesarConfidence({ sessionId: '../../etc/evil', value: 50 });
      // The slashes are rejected → falls back to a single safe file in the calibration dir.
      expect(existsSync(agonHomePath('calibration', 'unknown-session.jsonl'))).toBe(true);
      const record = JSON.parse(readFileSync(agonHomePath('calibration', 'unknown-session.jsonl'), 'utf-8').trim());
      expect(record.sessionId).toBe('unknown-session');
      expect(record.value).toBe(50);
    });
  });
});
