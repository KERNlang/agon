import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ORCHESTRATION_TOOLS,
  buildDirectAgonCommand,
  handleWriteToolCall,
} from '../../packages/mcp/src/generated/agon-orchestration.js';

const tempDirs: string[] = [];
const OLD_ENV = {
  AGON_SIGNAL_DIR: process.env.AGON_SIGNAL_DIR,
  AGON_SESSION_ID: process.env.AGON_SESSION_ID,
  AGON_CWD: process.env.AGON_CWD,
};

afterEach(() => {
  if (OLD_ENV.AGON_SIGNAL_DIR === undefined) delete process.env.AGON_SIGNAL_DIR;
  else process.env.AGON_SIGNAL_DIR = OLD_ENV.AGON_SIGNAL_DIR;
  if (OLD_ENV.AGON_SESSION_ID === undefined) delete process.env.AGON_SESSION_ID;
  else process.env.AGON_SESSION_ID = OLD_ENV.AGON_SESSION_ID;
  if (OLD_ENV.AGON_CWD === undefined) delete process.env.AGON_CWD;
  else process.env.AGON_CWD = OLD_ENV.AGON_CWD;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function waitForFile(dir: string, predicate: (name: string) => boolean): Promise<string> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const found = readdirSync(dir).find(predicate);
    if (found) return join(dir, found);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for signal file');
}

describe('agon orchestration MCP write tools', () => {
  it('writes a tool-completion signal after an approved AgonWrite', async () => {
    const signalDir = tempDir('agon-mcp-signals-');
    const cwd = tempDir('agon-mcp-cwd-');
    const sessionId = 'test-session';
    const target = join(cwd, 'created.txt');
    process.env.AGON_SIGNAL_DIR = signalDir;
    process.env.AGON_SESSION_ID = sessionId;
    process.env.AGON_CWD = cwd;

    const run = handleWriteToolCall('AgonWrite', { file_path: target, content: 'hello\n' });
    const requestPath = await waitForFile(signalDir, (name) => name.includes('-perm-') && !name.includes('-response'));
    const request = JSON.parse(readFileSync(requestPath, 'utf8'));
    writeFileSync(join(signalDir, `${sessionId}-perm-${request.id}-response.json`), JSON.stringify({ approved: true }));

    const result = await run;
    const completionPath = await waitForFile(signalDir, (name) => name.includes('-tool-'));
    const completion = JSON.parse(readFileSync(completionPath, 'utf8'));

    expect(result).toContain('File written:');
    expect(readFileSync(target, 'utf8')).toBe('hello\n');
    expect(existsSync(requestPath)).toBe(false);
    expect(completion).toMatchObject({
      type: 'tool-completion',
      tool: 'AgonWrite',
      status: 'done',
      args: { file_path: target, content: 'hello\n' },
    });
    expect(completion.output).toContain('File written:');
  });
});

describe('agon orchestration MCP direct command mapping', () => {
  it('maps external team tribunal calls with mode, rounds, members, and engines', () => {
    const result = buildDirectAgonCommand('Tribunal', {
      question: 'Should Cesar route this through Agon?',
      team: true,
      mode: 'red-team',
      rounds: 3,
      members: 3,
      engines: ['codex', 'claude', 'gemini'],
      cwd: '/tmp/project',
      timeout: 1200,
      engineTimeout: 180,
    });

    expect(result.cwd).toBe('/tmp/project');
    expect(result.timeoutMs).toBe(1_200_000);
    expect(result.commands).toEqual([
      [
        'call',
        'team-tribunal',
        'Should Cesar route this through Agon?',
        '--cwd',
        '/tmp/project',
        '--rounds',
        '3',
        '--tribunalMode',
        'red-team',
        '--members',
        '3',
        '--timeout',
        '180',
        '--engines',
        'codex,claude,gemini',
        '--jsonl',
      ],
    ]);
  });

  it('maps team forge and team brainstorm to their team subcommands', () => {
    expect(buildDirectAgonCommand('Forge', {
      task: 'Implement the bridge',
      fitnessCmd: 'npm test',
      team: true,
      members: 2,
      cwd: '/tmp/project',
    }).commands[0]).toEqual([
      'call',
      'team-forge',
      'Implement the bridge',
      '--test',
      'npm test',
      '--cwd',
      '/tmp/project',
      '--members',
      '2',
      '--jsonl',
    ]);

    expect(buildDirectAgonCommand('Brainstorm', {
      question: 'Which API should the bridge expose?',
      team: 'true',
      membersPerSide: 2,
      engines: 'codex,claude',
    }).commands[0]).toEqual([
      'call',
      'team-brainstorm',
      'Which API should the bridge expose?',
      '--cwd',
      process.cwd(),
      '--members',
      '2',
      '--engines',
      'codex,claude',
      '--jsonl',
    ]);
  });

  it('advertises direct-call controls to external MCP clients', () => {
    const tribunal = ORCHESTRATION_TOOLS.find((tool) => tool.name === 'Tribunal');
    const properties = tribunal?.inputSchema.properties as Record<string, unknown>;

    expect(properties.mode).toBeTruthy();
    expect(properties.team).toBeTruthy();
    expect(properties.engines).toBeTruthy();
    expect(properties.cwd).toBeTruthy();
    expect(properties.engineTimeout).toBeTruthy();
  });

  it('exposes finalizeOnScore and cesarSmart on the Forge tool schema', () => {
    const forge = ORCHESTRATION_TOOLS.find((tool) => tool.name === 'Forge');
    const properties = forge?.inputSchema.properties as Record<string, unknown>;
    expect(properties.finalizeOnScore).toBeTruthy();
    expect(properties.cesarSmart).toBeTruthy();
  });

  it('forwards explicit finalizeOnScore as --finalize-on-score for solo forge', () => {
    const result = buildDirectAgonCommand('Forge', {
      task: 'Fix the broken validator',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
      finalizeOnScore: 80,
    });
    const cmd = result.commands[0];
    expect(cmd).toContain('--finalize-on-score');
    expect(cmd[cmd.indexOf('--finalize-on-score') + 1]).toBe('80');
  });

  it('omits --finalize-on-score for team-forge (team variant ignores the flag)', () => {
    const result = buildDirectAgonCommand('Forge', {
      task: 'Fix the broken validator',
      fitnessCmd: 'npm test',
      team: true,
      cwd: '/tmp/project',
      finalizeOnScore: 80,
    });
    expect(result.commands[0]).not.toContain('--finalize-on-score');
  });

  it('derives finalizeOnScore from task class when cesarSmart=true and none explicit', () => {
    // bugfix → 85 per defaultFinalizeOnScoreForTask
    const result = buildDirectAgonCommand('Forge', {
      task: 'fix the off-by-one bug in the loop',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
      cesarSmart: true,
    });
    const cmd = result.commands[0];
    expect(cmd).toContain('--finalize-on-score');
    expect(cmd[cmd.indexOf('--finalize-on-score') + 1]).toBe('85');
  });

  it('cesarSmart yields no flag for high-stakes feature/algorithm tasks', () => {
    const result = buildDirectAgonCommand('Forge', {
      task: 'implement a new feature for authentication',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
      cesarSmart: true,
    });
    expect(result.commands[0]).not.toContain('--finalize-on-score');
  });

  it('explicit finalizeOnScore wins over cesarSmart derivation', () => {
    const result = buildDirectAgonCommand('Forge', {
      task: 'fix the bug',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
      cesarSmart: true,
      finalizeOnScore: 95,
    });
    const cmd = result.commands[0];
    expect(cmd).toContain('--finalize-on-score');
    expect(cmd[cmd.indexOf('--finalize-on-score') + 1]).toBe('95');
  });
});
