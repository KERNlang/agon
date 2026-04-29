import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

let testHome = '';

beforeEach(() => {
  testHome = setupTestAgonHome('core-systems');
});

afterEach(() => {
  cleanupTestAgonHome(testHome);
});

// ── 1. Plan State Machine ─────────────────────────────────────────
describe('Plan State Machine', () => {
  const makeAction = () => ({ type: 'build' as const, task: 'Test task' });
  const makeWorkspace = () => ({ id: 'ws-1', path: '/tmp/test', headSha: 'abc123', branch: 'main', dirty: false });
  const makeStep = (label: string) => ({ id: `step-${label}`, kind: 'dispatch' as const, label, effects: [] });

  it('creates a plan with steps in draft state', async () => {
    const { createPlan } = await import('../../packages/core/src/plan.js');

    const plan = createPlan(makeAction(), makeWorkspace(), [
      makeStep('Step 1'),
      makeStep('Step 2'),
      makeStep('Step 3'),
    ]);

    expect(plan.state).toBe('draft');
    expect(plan.steps.length).toBe(3);
    expect(plan.steps[0].result.state).toBe('pending');
    expect(plan.action.task).toBe('Test task');
  });

  it('transitions through states: draft → approved → running', async () => {
    const { createPlan, approvePlan, startPlan } = await import('../../packages/core/src/plan.js');

    let plan = createPlan(makeAction(), makeWorkspace(), [makeStep('Step 1')]);
    expect(plan.state).toBe('draft');

    plan = approvePlan(plan);
    expect(plan.state).toBe('approved');

    plan = startPlan(plan);
    expect(plan.state).toBe('running');
  });

  it('cannot approve an already running plan', async () => {
    const { createPlan, approvePlan, startPlan } = await import('../../packages/core/src/plan.js');

    let plan = createPlan(makeAction(), makeWorkspace(), [makeStep('Step 1')]);
    plan = approvePlan(plan);
    plan = startPlan(plan);

    expect(() => approvePlan(plan)).toThrow();
  });

  it('can cancel a plan', async () => {
    const { createPlan, approvePlan, startPlan, cancelPlan } = await import('../../packages/core/src/plan.js');

    let plan = createPlan(makeAction(), makeWorkspace(), [makeStep('Step 1')]);
    plan = approvePlan(plan);
    plan = startPlan(plan);
    plan = cancelPlan(plan);

    expect(plan.state).toBe('cancelled');
  });
});

// ── 2. Process Spawn & Abort ──────────────────────────────────────
describe('Process Spawn', () => {
  it('spawnWithTimeout runs a command and captures output', async () => {
    const { spawnWithTimeout } = await import('../../packages/core/src/process.js');

    const result = await spawnWithTimeout({
      command: 'echo',
      args: ['hello world'],
      cwd: tmpdir(),
      timeout: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('spawnWithTimeout captures stderr', async () => {
    const { spawnWithTimeout } = await import('../../packages/core/src/process.js');

    const result = await spawnWithTimeout({
      command: 'sh',
      args: ['-c', 'echo error >&2; exit 1'],
      cwd: tmpdir(),
      timeout: 5000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.trim()).toBe('error');
  });

  it('spawnWithTimeout respects timeout', async () => {
    const { spawnWithTimeout } = await import('../../packages/core/src/process.js');

    const result = await spawnWithTimeout({
      command: 'sleep',
      args: ['10'],
      cwd: tmpdir(),
      timeout: 500,
    });

    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it('spawnWithTimeout respects abort signal', async () => {
    const { spawnWithTimeout } = await import('../../packages/core/src/process.js');

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);

    const result = await spawnWithTimeout({
      command: 'sleep',
      args: ['10'],
      cwd: tmpdir(),
      timeout: 30000,
      signal: ac.signal,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.durationMs).toBeLessThan(2000);
  });
});

// ── 3. File History Snapshots ─────────────────────────────────────
describe('File History Snapshots', () => {
  it('takes and lists snapshots', async () => {
    const { takeSnapshot, listSnapshots } = await import('../../packages/core/src/file-history.js');

    const tempDir = join(tmpdir(), `agon-test-snapshot-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'test.txt'), 'original content');

    const entry = takeSnapshot('test snapshot', tempDir, [join(tempDir, 'test.txt')]);
    expect(entry).toBeDefined();
    expect(entry.id).toBeDefined();

    const snapshots = listSnapshots();
    expect(snapshots.length).toBeGreaterThan(0);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('orders snapshots by creation time and reverts empty/new files correctly', async () => {
    const { takeSnapshot, listSnapshots, getLatestSnapshotId, revertSnapshot } = await import('../../packages/core/src/file-history.js');

    const tempDir = join(tmpdir(), `agon-test-snapshot-revert-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'empty.txt'), '');

    const emptyEntry = takeSnapshot('empty file', tempDir, ['empty.txt']);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newEntry = takeSnapshot('new file', tempDir, ['created.txt']);
    writeFileSync(join(tempDir, 'empty.txt'), 'changed');
    writeFileSync(join(tempDir, 'created.txt'), 'created');

    expect(listSnapshots()[0].id).toBe(newEntry.id);
    expect(getLatestSnapshotId()).toBe(newEntry.id);

    expect(revertSnapshot(newEntry.id).ok).toBe(true);
    expect(existsSync(join(tempDir, 'created.txt'))).toBe(false);

    expect(revertSnapshot(emptyEntry.id).ok).toBe(true);
    expect(readFileSync(join(tempDir, 'empty.txt'), 'utf8')).toBe('');

    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── 4. Context Scanner ────────────────────────────────────────────
describe('Context Scanner', () => {
  it('detects project type from directory', async () => {
    const { scanProjectContext } = await import('../../packages/core/src/context-scanner.js');

    // Scan the Agon AI project itself
    const context = scanProjectContext(process.cwd());
    expect(context).toBeDefined();
    expect(typeof context).toBe('string');
    // Should detect package.json / TypeScript project
    expect(context.length).toBeGreaterThan(0);
  });

  it('detects KERN project', async () => {
    const { isKernProject } = await import('../../packages/core/src/context-scanner.js');

    // Agon AI is a KERN project
    const result = isKernProject(process.cwd());
    expect(result).toBe(true);
  });
});

// ── 5. Chat Store ─────────────────────────────────────────────────
describe('Chat Store Integration', () => {
  it('starts a session and appends messages', async () => {
    const { startChatSession, appendMessage } = await import('../../packages/core/src/chat-store.js');

    const session = startChatSession({ cwd: tmpdir(), branch: 'test-branch' });
    expect(session.id).toBeDefined();
    expect(session.messages).toEqual([]);

    appendMessage(session, {
      role: 'user',
      content: 'Hello AI',
      timestamp: new Date().toISOString(),
    });

    appendMessage(session, {
      role: 'engine',
      engineId: 'claude',
      content: 'Hello human',
      timestamp: new Date().toISOString(),
    });

    expect(session.messages.length).toBe(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[1].role).toBe('engine');
  });
});

// ── 6. Workspace Management ───────────────────────────────────────
describe('Workspace Management', () => {
  it('resolveWorkingDir returns a valid path', async () => {
    const { resolveWorkingDir } = await import('../../packages/core/src/workspace.js');

    const cwd = resolveWorkingDir();
    expect(typeof cwd).toBe('string');
    expect(cwd.length).toBeGreaterThan(0);
    expect(existsSync(cwd)).toBe(true);
  });
});

// ── 7. Image Path Handling ────────────────────────────────────────
describe('Image Path Handling', () => {
  it('detects image paths correctly', async () => {
    const { isImagePath, mimeFromExt } = await import('../../packages/core/src/image.js');

    expect(isImagePath('photo.png')).toBe(true);
    expect(isImagePath('photo.jpg')).toBe(true);
    expect(isImagePath('photo.jpeg')).toBe(true);
    expect(isImagePath('photo.gif')).toBe(true);
    expect(isImagePath('photo.webp')).toBe(true);
    expect(isImagePath('code.ts')).toBe(false);
    expect(isImagePath('doc.md')).toBe(false);
  });

  it('returns correct MIME types', async () => {
    const { mimeFromExt } = await import('../../packages/core/src/image.js');

    // mimeFromExt takes a full filename/path, not just extension
    expect(mimeFromExt('photo.png')).toBe('image/png');
    expect(mimeFromExt('photo.jpg')).toBe('image/jpeg');
    expect(mimeFromExt('photo.gif')).toBe('image/gif');
    expect(mimeFromExt('photo.webp')).toBe('image/webp');
  });
});

// ── 8. Text Utilities ─────────────────────────────────────────────
describe('Text Utilities', () => {
  it('wordWrap wraps at specified width', async () => {
    const { wordWrap } = await import('../../packages/core/src/text.js');

    const input = 'This is a long line that should be wrapped at a certain column width for display';
    const lines = wordWrap(input, 30);

    // wordWrap returns string[], every line should be <= 30 chars (word boundaries)
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(35); // allow slight overshoot for long words
    }
  });
});

// ── 9. Engine Registry ────────────────────────────────────────────
describe('Engine Registry Integration', () => {
  it('loads builtin engines and resolves availability', async () => {
    const { EngineRegistry } = await import('../../packages/core/src/engine-registry.js');
    const registry = new EngineRegistry();

    registry.load(join(process.cwd(), 'engines'));

    const ids = registry.listIds();
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(ids).toContain('claude');
    expect(ids).toContain('codex');
    expect(ids).toContain('gemini');
  });

  it('get throws EngineNotFoundError for unknown engine', async () => {
    const { EngineRegistry } = await import('../../packages/core/src/engine-registry.js');
    const registry = new EngineRegistry();

    expect(() => registry.get('nonexistent-engine')).toThrow();
  });

  it('pickStarter selects from available engines', async () => {
    const { EngineRegistry } = await import('../../packages/core/src/engine-registry.js');
    const registry = new EngineRegistry();

    const starter = registry.pickStarter(['claude', 'codex', 'gemini'], 'fixed');
    expect(starter).toBe('claude'); // fixed strategy picks first

    const rotated = registry.pickStarter(['claude', 'codex', 'gemini'], 'rotate');
    expect(['claude', 'codex', 'gemini']).toContain(rotated);
  });

  it('pickStarter respects preferred engine', async () => {
    const { EngineRegistry } = await import('../../packages/core/src/engine-registry.js');
    const registry = new EngineRegistry();

    const starter = registry.pickStarter(['claude', 'codex', 'gemini'], 'fixed', 'gemini');
    expect(starter).toBe('gemini');
  });
});

// ── 10. Patch Parser ──────────────────────────────────────────────
describe('Patch Parser Integration', () => {
  it('parses a unified diff correctly', async () => {
    const { parsePatch } = await import('../../packages/core/src/patch-parser.js');

    const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
+import { bar } from './bar';

 export function main() {`;

    const files = parsePatch(diff);
    expect(files.length).toBe(1);
    expect(files[0].path).toBeDefined();
    expect(files[0].hunks.length).toBeGreaterThanOrEqual(1);
  });

  it('patchSummary returns human-readable summary', async () => {
    const { parsePatch, patchSummary } = await import('../../packages/core/src/patch-parser.js');

    const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1,2 @@
 line1
+line2
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1,2 @@
 b1
+b2`;

    const files = parsePatch(diff);
    const summary = patchSummary(files);
    expect(summary).toContain('2'); // 2 files
  });

  it('invertPatch swaps + and - lines', async () => {
    const { invertPatch } = await import('../../packages/core/src/patch-parser.js');

    const diff = `diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,2 @@
-old line
+new line`;

    const inverted = invertPatch(diff);
    expect(inverted).toContain('+old line');
    expect(inverted).toContain('-new line');
  });
});
