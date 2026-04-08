// @kern-source: review:4
import { execFileSync } from 'node:child_process';

// @kern-source: review:5
import { join } from 'node:path';

// @kern-source: review:6
import { mkdirSync } from 'node:fs';

// @kern-source: review:7
import { ensureAgonHome, RUNS_DIR, appendMessage, tracker, StreamParser, scanProjectContext, resolveWorkingDir } from '@agon/core';

// @kern-source: review:8
import { ENGINE_COLORS } from '../blocks/output-format.js';

// @kern-source: review:9
import type { Dispatch, HandlerContext } from '../../handlers/types.js';

// @kern-source: review:11
export function resolveReviewTarget(target: string|undefined, cwd: string): {diff:string, label:string} {
  const t = (target ?? 'uncommitted').trim();
  let diff = '';
  let label = '';
  
  if (t === 'uncommitted') {
    label = 'uncommitted changes';
    try {
      // Use git diff HEAD to get a single consistent diff against HEAD
      // (covers both staged and unstaged changes against the same base)
      diff = execFileSync('git', ['diff', 'HEAD'], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
  
      // Also include untracked files so new files aren't silently omitted
      const untrackedRaw = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
      if (untrackedRaw) {
        const untrackedFiles = untrackedRaw.split('\n').filter(Boolean);
        const untrackedDiffs: string[] = [];
        for (const f of untrackedFiles) {
          try {
            const content = execFileSync('git', ['diff', '--no-index', '/dev/null', f], { cwd, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }).trim();
            if (content) untrackedDiffs.push(content);
          } catch {
            // git diff --no-index exits non-zero when files differ, that's expected
            try {
              const content = execFileSync('git', ['diff', '--no-index', '--', '/dev/null', f], { cwd, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }).trim();
              if (content) untrackedDiffs.push(content);
            } catch (e2: any) {
              // exit code 1 means diff found (expected), capture stdout
              if (e2.stdout) untrackedDiffs.push(String(e2.stdout).trim());
            }
          }
        }
        if (untrackedDiffs.length > 0) {
          diff = diff ? `${diff}\n\n${untrackedDiffs.join('\n\n')}` : untrackedDiffs.join('\n\n');
        }
      }
    } catch (err) {
      throw new Error(`Failed to get uncommitted diff: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (t.startsWith('branch:')) {
    const branch = t.slice(7);
    label = `branch ${branch}`;
    try {
      diff = execFileSync('git', ['diff', `${branch}...HEAD`], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
    } catch (err) {
      throw new Error(`Failed to get branch diff for ${branch}: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (t.startsWith('commit:')) {
    const sha = t.slice(7);
    label = `commit ${sha.slice(0, 8)}`;
    try {
      diff = execFileSync('git', ['show', sha], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
    } catch (err) {
      throw new Error(`Failed to get commit ${sha}: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    throw new Error(`Unknown review target: "${t}". Use "uncommitted", "branch:NAME", or "commit:SHA".`);
  }
  
  // Cap diff at 100K chars
  if (diff.length > 100_000) {
    diff = diff.slice(0, 100_000) + '\n... [truncated — diff exceeds 100K chars]';
  }
  
  return { diff, label };
}

// @kern-source: review:79
export function selectReviewEngine(requestedEngine: string|undefined, ctx: HandlerContext): string {
  const active = ctx.activeEngines();
  
  if (requestedEngine) {
    if (!active.includes(requestedEngine)) {
      throw new Error(`Engine "${requestedEngine}" is not available. Active engines: ${active.join(', ')}`);
    }
    return requestedEngine;
  }
  
  // Preference order: reviewDefaultEngine > forgeFixedStarter > first active with review mode
  const config = ctx.config as any;
  const preferred = config.reviewDefaultEngine ?? config.forgeFixedStarter ?? 'claude';
  
  // Only use preferred if it's active AND supports review mode
  if (active.includes(preferred)) {
    try {
      const prefEngine = ctx.registry.get(preferred);
      if (prefEngine.review) return preferred;
    } catch { /* fall through to capability scan */ }
  }
  
  // Fall back to first available engine that has review mode
  for (const id of active) {
    try {
      const engine = ctx.registry.get(id);
      if (engine.review) return id;
    } catch { /* skip unavailable */ }
  }
  
  // Last resort: first active engine
  if (active.length > 0) return active[0];
  
  throw new Error('No engines available for review. Try /engines to check availability.');
}

// @kern-source: review:116
export async function handleReview(dispatch: Dispatch, ctx: HandlerContext, target?: string, requestedEngine?: string): Promise<void> {
  const abort = new AbortController();
  try {
    ensureAgonHome();
    const cwd = resolveWorkingDir();
    
    // 1. Resolve target diff
    let diff: string;
    let label: string;
    try {
      ({ diff, label } = resolveReviewTarget(target, cwd));
    } catch (err) {
      dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    
    if (!diff.trim()) {
      dispatch({ type: 'info', message: `No changes to review (${label}).` });
      return;
    }
    
    // 2. Select engine
    let engineId: string;
    try {
      engineId = selectReviewEngine(requestedEngine, ctx);
    } catch (err) {
      dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    
    const engine = ctx.registry.get(engineId);
    const color = (ENGINE_COLORS as Record<string, number>)[engineId] ?? 245;
    
    // 3. Build prompt
    const config = ctx.config;
    const projectCtx = scanProjectContext(cwd, config.projectContext || undefined, config.contextFormat as 'plain' | 'kern');
    
    const parts: string[] = [];
    if (projectCtx) parts.push(`## PROJECT CONTEXT\n${projectCtx}`);
    parts.push(`## REVIEW REQUEST\nReview the following ${label}.`);
    parts.push(`## DIFF\n\`\`\`diff\n${diff}\n\`\`\``);
    parts.push(`## INSTRUCTIONS\nProvide a thorough code review:\n- Bugs and logic errors\n- Security vulnerabilities\n- Performance issues\n- Code quality and readability\n- Missing edge cases\n\nFor each issue: file, line range, severity (blocking|important|nit), suggested fix.`);
    const prompt = parts.join('\n\n');
    
    // 4. Dispatch — no plan model, review runs immediately
    const outputDir = join(RUNS_DIR, `review-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
    ctx.setActiveAbort(abort);
    
    dispatch({ type: 'spinner-start', message: `${engineId} reviewing ${label}…`, color });
    
    let response = '';
    let streaming = false;
    
    try {
      const dispatchOpts = {
        engine,
        prompt,
        cwd,
        mode: 'review' as const,
        timeout: (config as any).reviewTimeout ?? config.agentTimeout ?? 420,
        outputDir,
        signal: abort.signal,
      };
    
      // Prefer streaming when available
      if (ctx.adapter.dispatchStream) {
        const gen = ctx.adapter.dispatchStream(dispatchOpts);
        const parser = new StreamParser();
    
        while (true) {
          const iter = await gen.next();
          if (iter.done) break;
          if (abort.signal.aborted) break;
          const chunk = iter.value as string;
    
          if (chunk.startsWith('\x00')) {
            const status = chunk.slice(1).trim();
            if (status) dispatch({ type: 'spinner-update', message: `${engineId} ${status}` });
            continue;
          }
    
          for (const parsed of parser.feed(chunk)) {
            if (parsed.type === 'status') {
              dispatch({ type: 'spinner-update', message: `${engineId} ${parsed.content}` });
              continue;
            }
            if (parsed.type === 'text' || parsed.type === 'raw') {
              if (!streaming) {
                dispatch({ type: 'spinner-stop' });
                streaming = true;
              }
              dispatch({ type: 'streaming-chunk', engineId, chunk: parsed.content });
              response += parsed.content;
            }
          }
        }
    
        for (const parsed of parser.flush()) {
          if (parsed.type === 'text' || parsed.type === 'raw') {
            if (!streaming) {
              dispatch({ type: 'spinner-stop' });
              streaming = true;
            }
            dispatch({ type: 'streaming-chunk', engineId, chunk: parsed.content });
            response += parsed.content;
          }
        }
      } else {
        // Batch dispatch fallback
        const result = await ctx.adapter.dispatch(dispatchOpts);
        response = result.stdout;
        dispatch({ type: 'spinner-stop' });
      }
    } catch (err) {
      dispatch({ type: 'spinner-stop' });
      dispatch({ type: 'error', message: `${engineId}: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    
    if (abort.signal.aborted) {
      dispatch({ type: 'spinner-stop' });
      return;
    }
    
    response = response.trim();
    
    // 5. Display results
    if (!streaming && response) {
      dispatch({ type: 'engine-block', engineId, color, content: response });
    }
    if (streaming) {
      dispatch({ type: 'streaming-end', engineId });
    }
    
    // 6. Store in chat session and track
    if (response) {
      appendMessage(ctx.chatSession, { role: 'user', content: `[review ${label}]`, timestamp: new Date().toISOString() });
      appendMessage(ctx.chatSession, { role: 'engine', engineId, content: response, timestamp: new Date().toISOString() });
      tracker.record(engineId, { prompt, response });
    
      // 7. Store structured last review result for "fix it" flow
      ctx.lastReviewResult = {
        engineId,
        target: target ?? 'uncommitted',
        label,
        diff,
        reviewOutput: response,
        timestamp: Date.now(),
      };
    
      dispatch({ type: 'info', message: `Review complete. Say "fix it" or "fix it with <engine>" to address the findings.` });
    } else {
      dispatch({ type: 'warning', message: `${engineId} returned no review output.` });
    }
  } finally {
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  }
}

