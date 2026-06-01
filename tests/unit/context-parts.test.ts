import { describe, it, expect } from 'vitest';
import { buildStageContext, renderStageContext } from '@kernlang/agon-core';

describe('buildStageContext', () => {
  const baseOpts = {
    engineId: 'claude',
    pass: true,
    score: 85,
    prompt: '## TASK\nRefactor the auth middleware to use JWT tokens\n\n## FITNESS TEST\nnpm test',
    diff: `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,5 @@
+import jwt from 'jsonwebtoken';
 export function authenticate(req) {
-  return req.headers.cookie;
+  const token = req.headers.authorization?.split(' ')[1];
+  return jwt.verify(token, process.env.JWT_SECRET);
 }`,
  };

  it('extracts goal from ## TASK section', () => {
    const ctx = buildStageContext(baseOpts);
    expect(ctx.goal).toContain('Refactor the auth middleware');
  });

  it('extracts files from diff', () => {
    const ctx = buildStageContext(baseOpts);
    expect(ctx.filesModified).toContain('src/auth.ts');
  });

  it('sets filesDiscovered = filesModified when no dispatch output', () => {
    const ctx = buildStageContext(baseOpts);
    expect(ctx.filesDiscovered).toEqual(ctx.filesModified);
  });

  it('extracts decisions from dispatchStdout', () => {
    const ctx = buildStageContext({
      ...baseOpts,
      dispatchStdout: 'I will use jsonwebtoken for token validation.\nDecision: use RS256 algorithm for signing.',
    });
    expect(ctx.decisions.length).toBeGreaterThanOrEqual(1);
    expect(ctx.decisions[0].choice).toContain('jsonwebtoken');
  });

  it('extracts tool refs from XML markers in dispatchStdout', () => {
    const ctx = buildStageContext({
      ...baseOpts,
      dispatchStdout: '<tool name="Read">{"file_path":"src/auth.ts"}</tool>',
    });
    expect(ctx.toolResultRefs.length).toBe(1);
    expect(ctx.toolResultRefs[0].toolName).toBe('Read');
    expect(ctx.toolResultRefs[0].filePath).toBe('src/auth.ts');
  });

  it('generates diff summary from change lines', () => {
    const ctx = buildStageContext(baseOpts);
    expect(ctx.diffSummary).toContain('+import jwt');
  });

  it('handles empty diff', () => {
    const ctx = buildStageContext({ ...baseOpts, diff: '' });
    expect(ctx.diffSummary).toBeNull();
    expect(ctx.filesModified).toEqual([]);
  });

  it('handles missing dispatchStdout', () => {
    const ctx = buildStageContext(baseOpts);
    expect(ctx.decisions).toEqual([]);
    expect(ctx.patternsFound).toEqual([]);
    expect(ctx.toolResultRefs).toEqual([]);
  });

  it('caps decisions at 5', () => {
    const stdout = Array(10).fill('Decision: use approach X').join('\n');
    const ctx = buildStageContext({ ...baseOpts, dispatchStdout: stdout });
    expect(ctx.decisions.length).toBeLessThanOrEqual(5);
  });

  it('preserves fitnessLogPath', () => {
    const ctx = buildStageContext({ ...baseOpts, fitnessLogPath: '/tmp/forge/claude-fitness.txt' });
    expect(ctx.fitnessLogPath).toBe('/tmp/forge/claude-fitness.txt');
  });

  it('defaults fitnessLogPath to null', () => {
    const ctx = buildStageContext(baseOpts);
    expect(ctx.fitnessLogPath).toBeNull();
  });
});

describe('renderStageContext', () => {
  it('renders PASSED status with score', () => {
    const ctx = buildStageContext({
      engineId: 'claude',
      pass: true,
      score: 92,
      prompt: '## TASK\nFix bug',
      diff: 'diff --git a/foo.ts b/foo.ts\n+fix',
    });
    const rendered = renderStageContext(ctx);
    expect(rendered).toContain('PASSED');
    expect(rendered).toContain('score: 92');
    expect(rendered).toContain('claude');
  });

  it('renders FAILED status', () => {
    const ctx = buildStageContext({
      engineId: 'codex',
      pass: false,
      score: 30,
      prompt: '## TASK\nFix bug',
      diff: '',
    });
    const rendered = renderStageContext(ctx);
    expect(rendered).toContain('FAILED');
    expect(rendered).toContain('codex');
  });

  it('renders files modified', () => {
    const ctx = buildStageContext({
      engineId: 'test',
      pass: true,
      score: 80,
      prompt: 'task',
      diff: 'diff --git a/src/a.ts b/src/a.ts\n+x\ndiff --git a/src/b.ts b/src/b.ts\n+y',
    });
    const rendered = renderStageContext(ctx);
    expect(rendered).toContain('src/a.ts');
    expect(rendered).toContain('src/b.ts');
  });

  it('renders fitness log path', () => {
    const ctx = buildStageContext({
      engineId: 'test',
      pass: true,
      score: 80,
      prompt: 'task',
      diff: '',
      fitnessLogPath: '/tmp/forge/test-fitness.txt',
    });
    const rendered = renderStageContext(ctx);
    expect(rendered).toContain('/tmp/forge/test-fitness.txt');
  });

  it('includes "find your own solution" guidance', () => {
    const ctx = buildStageContext({
      engineId: 'test',
      pass: true,
      score: 80,
      prompt: 'task',
      diff: '',
    });
    const rendered = renderStageContext(ctx);
    expect(rendered).toContain('find your own solution');
  });
});
