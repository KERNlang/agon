import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { handleWriteToolCall } from '../../packages/mcp/src/generated/agon-orchestration.js';

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
