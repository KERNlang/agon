// @kern-source: pipeline:1
import { join } from 'node:path';

// @kern-source: pipeline:2
import { mkdirSync } from 'node:fs';

// @kern-source: pipeline:3
import { ensureAgonHome, RUNS_DIR, appendMessage, tracker, scanProjectContext, readOnlyDiff, diffLineCount, diffFileCount, buildCritiquePrompt, spawnWithTimeout, resolveWorkingDir } from '@agon/core';

// @kern-source: pipeline:4
import { ENGINE_COLORS } from '../blocks/output-format.js';

// @kern-source: pipeline:5
import type { Dispatch, HandlerContext } from '../../handlers/types.js';

// @kern-source: pipeline:7
export async function handlePipeline(input: string, dispatch: Dispatch, ctx: HandlerContext, fitnessCmd?: string, opts?: {quiet?:boolean}): Promise<void> {
  const abort = new AbortController();
  try {
    ensureAgonHome();
    
    const agentIds = ctx.registry.agentCapableIds();
    if (agentIds.length === 0) {
      dispatch({ type: 'error', message: 'No agent-capable engines available.' });
      return;
    }
    
    const config = ctx.config;
    const cwd = resolveWorkingDir();
    const preferred = config.forgeFixedStarter ?? 'claude';
    const buildEngine = agentIds.includes(preferred) ? preferred : agentIds[0];
    const reviewEngine = agentIds.find((id: string) => id !== buildEngine) ?? buildEngine;
    const maxIterations = 3;
    
    const projectCtx = scanProjectContext(cwd, config.projectContext || undefined, config.contextFormat as 'plain' | 'kern');
    const outputDir = join(RUNS_DIR, `pipeline-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
    
    const recent = ctx.chatSession.messages.slice(-10);
    const sessionHistory = recent.length > 0
      ? recent.map((m: any) => m.role === 'user' ? `User: ${m.content}` : `${m.engineId ?? 'engine'}: ${m.content.slice(0, 500)}`).join('\n\n')
      : '';
    
    const quiet = opts?.quiet ?? false;
    
    ctx.setActiveAbort(abort);
    
    if (!quiet) {
      dispatch({ type: 'header', title: `Pipeline: ${buildEngine} builds → ${reviewEngine} reviews` });
      dispatch({ type: 'info', message: `Task: ${input}` });
      if (fitnessCmd) dispatch({ type: 'info', message: `Fitness: ${fitnessCmd}` });
    }
    
    let iteration = 0;
    let lastReviewFeedback = '';
    
    while (iteration < maxIterations) {
      iteration++;
      if (abort.signal.aborted) break;
    
      // ── Step 1: Build ──
      const buildColor = (ENGINE_COLORS as Record<string, number>)[buildEngine] ?? 124;
      dispatch({ type: 'spinner-start', message: `[${iteration}/${maxIterations}] ${buildEngine} building…`, color: buildColor });
    
      const buildPrompt = [
        projectCtx ? `## PROJECT CONTEXT\n${projectCtx}` : '',
        sessionHistory ? `## SESSION HISTORY (recent messages)\n${sessionHistory}` : '',
        `## TASK\n${input}`,
        lastReviewFeedback ? `## REVIEW FEEDBACK FROM PREVIOUS ITERATION\nAddress these issues:\n${lastReviewFeedback}` : '',
        fitnessCmd ? `## FITNESS TEST\nRun this to verify: \`${fitnessCmd}\`` : '',
        `## CONSTRAINTS\n- You have full tool access. Read files, edit code, run commands.\n- Modify only what's necessary.\n- ${fitnessCmd ? 'Run the fitness test and iterate until it passes.' : 'Exit when the task is complete.'}`,
      ].filter(Boolean).join('\n\n');
    
      try {
        const engine = ctx.registry.get(buildEngine);
        if (ctx.adapter.dispatchAgent) {
          await ctx.adapter.dispatchAgent({
            engine,
            prompt: buildPrompt,
            cwd,
            mode: 'agent',
            timeout: config.agentTimeout ?? 600,
            outputDir,
            signal: abort.signal,
          });
        } else {
          await ctx.adapter.dispatch({
            engine,
            prompt: buildPrompt,
            cwd,
            mode: 'review',
            timeout: engine.timeout,
            outputDir,
            signal: abort.signal,
          });
        }
      } catch (err) {
        dispatch({ type: 'spinner-stop' });
        dispatch({ type: 'error', message: `Build failed: ${err instanceof Error ? err.message : String(err)}` });
        break;
      }
    
      dispatch({ type: 'spinner-stop' });
      if (abort.signal.aborted) break;
    
      // ── Check diff (read-only — don't stage unrelated files) ──
      const diff = readOnlyDiff(cwd);
      const lines = diffLineCount(diff);
      const files = diff ? diff.split('\n').filter((l: string) => l.startsWith('diff --git')).length : 0;
    
      if (!diff || lines === 0) {
        dispatch({ type: 'warning', message: `[${iteration}] ${buildEngine} made no changes.` });
        break;
      }
    
      dispatch({ type: 'info', message: `[${iteration}] ${buildEngine}: ${files} file(s), ${lines} line(s) changed` });
    
      // ── Step 2: Fitness test (if provided) ──
      if (fitnessCmd) {
        dispatch({ type: 'spinner-start', message: `[${iteration}] Running fitness: ${fitnessCmd.slice(0, 50)}` });
        try {
          const fitnessResult = await spawnWithTimeout({
            command: '/bin/sh',
            args: ['-c', fitnessCmd],
            cwd,
            timeout: 120000,
          });
          dispatch({ type: 'spinner-stop' });
          if (fitnessResult.exitCode === 0) {
            dispatch({ type: 'success', message: `[${iteration}] Fitness passed!` });
            // Tests pass — still review for quality, but don't iterate further
            break;
          } else {
            dispatch({ type: 'warning', message: `[${iteration}] Fitness failed (exit ${fitnessResult.exitCode})` });
            if (fitnessResult.stderr.trim()) {
              lastReviewFeedback = `Fitness test failed:\n${fitnessResult.stderr.trim().slice(0, 2000)}`;
              // Continue to next iteration with error feedback
              continue;
            }
          }
        } catch (err) {
          dispatch({ type: 'spinner-stop' });
          dispatch({ type: 'warning', message: `[${iteration}] Fitness command failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    
      // ── Step 3: Review (different engine) ──
      if (buildEngine === reviewEngine || iteration >= maxIterations) break;
    
      const reviewColor = (ENGINE_COLORS as Record<string, number>)[reviewEngine] ?? 124;
      dispatch({ type: 'spinner-start', message: `[${iteration}] ${reviewEngine} reviewing…`, color: reviewColor });
    
      const critiquePrompt = buildCritiquePrompt({
        winnerEngine: buildEngine,
        diff,
        maxCritiques: 3,
      });
    
      try {
        const revEngine = ctx.registry.get(reviewEngine);
        const reviewResult = await ctx.adapter.dispatch({
          engine: revEngine,
          prompt: critiquePrompt,
          cwd,
          mode: 'exec',
          timeout: 60,
          outputDir,
          signal: abort.signal,
        });
        dispatch({ type: 'spinner-stop' });
    
        const reviewOutput = reviewResult.stdout.trim();
    
        // Parse structured critiques — only iterate on blocking issues
        let hasBlockingIssues = false;
        try {
          const allMatches = [...reviewOutput.matchAll(/\[[\s\S]*?\]/g)];
          const jsonStr = allMatches.length > 0 ? allMatches[allMatches.length - 1][0] : null;
          if (jsonStr) {
            const parsed = JSON.parse(jsonStr) as Array<{blocking?: boolean; problem?: string}>;
            hasBlockingIssues = parsed.some((c) => c.blocking === true);
            if (!hasBlockingIssues && parsed.length > 0) {
              dispatch({ type: 'info', message: `[${iteration}] ${reviewEngine}: ${parsed.length} nit(s), no blocking issues.` });
              break;
            }
          }
        } catch (_parseErr) {
          // Fallback to string heuristic if JSON parse fails
          hasBlockingIssues = reviewOutput.length > 10 && !reviewOutput.includes('[]');
        }
    
        if (!hasBlockingIssues) {
          dispatch({ type: 'success', message: `[${iteration}] ${reviewEngine} approved — no blocking issues.` });
          break;
        }
    
        if (!quiet) {
          dispatch({ type: 'engine-block', engineId: reviewEngine, color: reviewColor, content: reviewOutput });
        } else {
          dispatch({ type: 'info', message: `[${iteration}] ${reviewEngine} found blocking issues — fixing…` });
        }
        lastReviewFeedback = reviewOutput;
        // Continue to next iteration with review feedback
      } catch (err) {
        dispatch({ type: 'spinner-stop' });
        dispatch({ type: 'warning', message: `[${iteration}] Review failed: ${err instanceof Error ? err.message : String(err)} — accepting build as-is.` });
        break;
      }
    }
    
    // ── Summary + auto-escalation ──
    const finalDiff = readOnlyDiff(cwd);
    const finalLines = diffLineCount(finalDiff);
    const finalFiles = diffFileCount(cwd);
    
    // Check if fitness passed on last iteration
    let fitnessPassed = false;
    if (fitnessCmd && finalLines > 0) {
      try {
        const finalFitness = await spawnWithTimeout({
          command: '/bin/sh',
          args: ['-c', fitnessCmd],
          cwd,
          timeout: 120000,
        });
        fitnessPassed = finalFitness.exitCode === 0;
      } catch (err) {
        console.warn(`[agon] final fitness check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    
    if (finalLines > 0 && (!fitnessCmd || fitnessPassed)) {
      dispatch({ type: 'success', message: `Pipeline complete: ${finalFiles} file(s), ${finalLines} line(s) changed in ${iteration} iteration(s)` });
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(ctx.chatSession, { role: 'engine', engineId: buildEngine, content: `Pipeline: ${finalFiles} files, ${finalLines} lines in ${iteration} iteration(s)`, timestamp: new Date().toISOString() });
      tracker.record(buildEngine, { prompt: input, response: `pipeline:${finalLines}lines` });
    } else if (fitnessCmd && !fitnessPassed && iteration >= maxIterations) {
      // Auto-escalation: pipeline exhausted → suggest forge
      dispatch({ type: 'warning', message: `Pipeline exhausted ${maxIterations} iterations without passing fitness.` });
      dispatch({ type: 'info', message: `Escalating → forge competition. Run: /forge ${input} test with ${fitnessCmd}` });
      appendMessage(ctx.chatSession, { role: 'engine', engineId: 'pipeline', content: `Pipeline failed after ${maxIterations} iterations. Suggested escalation to forge.`, timestamp: new Date().toISOString() });
    } else if (finalLines === 0) {
      dispatch({ type: 'info', message: 'Pipeline complete — no changes made.' });
    } else {
      dispatch({ type: 'success', message: `Pipeline complete: ${finalFiles} file(s), ${finalLines} line(s) changed in ${iteration} iteration(s)` });
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(ctx.chatSession, { role: 'engine', engineId: buildEngine, content: `Pipeline: ${finalFiles} files, ${finalLines} lines`, timestamp: new Date().toISOString() });
      tracker.record(buildEngine, { prompt: input, response: `pipeline:${finalLines}lines` });
    }
  } finally {
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  }
}

