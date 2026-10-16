import { defineCommand } from 'citty';

import { EngineRegistry, ensureAgonHome, loadConfig, createRunDir, spawnWithTimeout, appendAttribution, appendPrAttribution, githubRepoUrl, defaultBaseBranch } from '@kernlang/agon-core';

import { runConquer, runPrText, createConquerIsolation } from '@kernlang/agon-forge';
import { publishConquerBranch, prepareConquerPullRequest } from '@kernlang/agon-mod-conquer';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import { captureProcessSurfaceAuthority, assertProcessSurfaceAvailable } from '../surface-authority-runtime.js';

import type { ConquerResult, ConquerTurn } from '@kernlang/agon-forge';

import { resolveBuiltinEnginesDir } from '../lib/engines-dir.js';

import { createCliAdapter } from '@kernlang/agon-adapter-cli';

import { header, info, bold, dim } from '../blocks/output-format.js';

import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';

export const conquerCommand: any = defineCommand({
  meta: {
    name: 'conquer',
    description: 'Supervised-autonomous build: Cesar drives an external builder CLI (codex/claude/agy) unattended toward a task, convening nero/tribunal/council on forks, and stops at a human merge gate. `agon conquer "<task>" --gate "<test cmd>"`.',
  },
  args: {
    task: { type: 'positional', description: 'What to build.', required: false },
    builder: { type: 'string', alias: 'b', description: 'Builder engine (codex|claude|agy). Default: codex if active, else the first active engine.' },
    engines: { type: 'string', alias: 'e', description: 'Advisor pool for consults (comma-separated). Default: active orchestration engines minus the builder.' },
    gate: { type: 'string', alias: 'g', description: 'REQUIRED — the acceptance gate command (build/typecheck/lint/tests), e.g. "npm run build && npm test". This IS the done-oracle.' },
    gateTimeout: { type: 'string', description: 'Per-gate timeout in seconds (default 1800).' },
    maxTurns: { type: 'string', description: 'Max builder turns (default 40).' },
    maxHours: { type: 'string', description: 'Wall-clock cap in hours (default: none).' },
    timeout: { type: 'string', description: 'Per-builder-turn timeout in seconds (default 600).' },
    push: { type: 'boolean', description: 'On success, commit and push the isolated conquer branch (prints a PR hint). Default: leave the isolated branch/worktree for review.' },
    label: { type: 'string', description: 'Human-readable suffix baked into the run dir name.' },
  },
  async run({ args }) {
    const assertInvocationCurrent = captureProcessSurfaceAuthority();
    ensureAgonHome();
    const cwd = process.cwd();
    const config = loadConfig(cwd);

    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());
    const adapter = createCliAdapter(registry);

    const positionals = Array.isArray((args as any)._) ? (args as any)._.map(String) : [];
    const taskStr = (typeof args.task === 'string' && args.task.trim())
      ? args.task.trim()
      : positionals.join(' ').trim();
    if (!taskStr) {
      console.error('Provide a task. Usage: agon conquer "build X" --gate "npm run build && npm test"');
      process.exitCode = 1;
      return;
    }

    const gate = typeof args.gate === 'string' ? args.gate.trim() : '';
    if (!gate) {
      console.error('A --gate command is required — it is the done-oracle. e.g. --gate "npm run build && npm test"');
      process.exitCode = 1;
      return;
    }

    const activeIds = registry.activeIds(config as any);
    const active = filterDefaultOrchestrationEngines(activeIds);
    const builder = (typeof args.builder === 'string' && args.builder.trim())
      ? registry.resolveId(args.builder.trim())
      : (active.includes('codex') ? 'codex' : active[0]);
    if (!builder || !activeIds.includes(builder)) {
      console.error(`Builder engine '${args.builder ?? builder ?? '(none)'}' is not available (not installed or missing credentials). Run \`agon engine list\`.`);
      process.exitCode = 1;
      return;
    }

    let advisors = active.filter((e) => e !== builder);
    if (typeof args.engines === 'string' && args.engines.trim()) {
      // An explicit advisor list must be valid + active — never silently fall back to
      // defaults on a typo (that would run a different panel than the user asked for).
      const requested = args.engines.split(',').map((s) => s.trim()).filter(Boolean);
      const resolved = requested.map((s) => registry.resolveId(s));
      const bad = requested.filter((_s, i) => !activeIds.includes(resolved[i]));
      if (bad.length > 0) {
        console.error(`Advisor engine${bad.length > 1 ? 's' : ''} not available: ${bad.join(', ')}. Run \`agon engine list\`.`);
        process.exitCode = 1;
        return;
      }
      advisors = resolved.filter((id) => id !== builder);
    }

    const maxTurns = parseInt(String(args.maxTurns ?? '40'), 10);
    if (Number.isNaN(maxTurns) || maxTurns < 1) { console.error(`Invalid --max-turns: ${args.maxTurns}`); process.exitCode = 1; return; }
    let maxHours = 0;
    if (args.maxHours !== undefined && String(args.maxHours).trim() !== '') {
      maxHours = parseFloat(String(args.maxHours));
      if (Number.isNaN(maxHours) || maxHours < 0) { console.error(`Invalid --max-hours: ${args.maxHours}`); process.exitCode = 1; return; }
    }
    const turnTimeoutRaw = parseInt(String(args.timeout ?? '600'), 10);
    const turnTimeout = Number.isFinite(turnTimeoutRaw) && turnTimeoutRaw > 0 ? turnTimeoutRaw : 600;
    const gateTimeoutRaw = parseInt(String(args.gateTimeout ?? '1800'), 10);
    const gateTimeout = Number.isFinite(gateTimeoutRaw) && gateTimeoutRaw > 0 ? gateTimeoutRaw : 1800;

    const { path: outputDir } = createRunDir({ mode: 'conquer', label: args.label, announce: false });
    let isolation;
    try {
      isolation = createConquerIsolation(taskStr, cwd);
    } catch (err) {
      console.error(`Could not create the Conquer worktree: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    const { repoRoot: root, branch, path: worktreeCwd } = isolation;
    try {
      const sourceStatus = await spawnWithTimeout({ command: 'git', args: ['status', '--porcelain'], cwd, timeout: 15_000 });
      if (String(sourceStatus.stdout ?? '').trim()) {
        info(dim('The source checkout has uncommitted work. It remains untouched and is not included in this HEAD-based Conquer branch.'));
      }
    } catch { /* isolation is already established; status is advisory */ }

    header(`Conquer · builder=${builder} · advisors=${advisors.join(',') || '(none)'}`);
    info(taskStr.length > 120 ? taskStr.slice(0, 120) + '…' : taskStr);
    info(dim(`gate: ${gate}`));
    info(dim(`isolated branch: ${branch}`));
    info(dim(`worktree: ${worktreeCwd}`));
    console.log('');

    // The done-oracle's environment ops: diff (for L1 acceptance-drift) + the gate
    // (L0). oracleTampered is left false in v1 — L1 diff-integrity catches test
    // weakening; a frozen-oracle hash is the hardening follow-up.
    const evaluateDone = async (_claim: string) => {
      try {
        const diffRes = await spawnWithTimeout({ command: 'git', args: ['diff'], cwd: worktreeCwd, timeout: 30_000 });
        const gateRes = await spawnWithTimeout({ command: 'sh', args: ['-c', gate], cwd: worktreeCwd, timeout: gateTimeout * 1000 });
        return { diff: String(diffRes.stdout ?? ''), gateOk: gateRes.exitCode === 0, oracleTampered: false };
      } catch (err) {
        // A spawn failure (no fds, shell init, etc.) must not crash the unattended loop —
        // treat the done-check as "not done" so the builder keeps going or hits a cap.
        info(dim(`done-check gate errored: ${err instanceof Error ? err.message : String(err)} — treating as not-done.`));
        return { diff: '', gateOk: false, oracleTampered: false };
      }
    };

    let result: ConquerResult;
    try {
      result = await runConquer({
        task: taskStr,
        builderEngine: builder,
        advisorEngines: advisors,
        registry,
        adapter,
        timeout: turnTimeout,
        outputDir,
        cwd: worktreeCwd,
        gate,
        caps: { maxTurns, maxWallClockMs: maxHours > 0 ? Math.round(maxHours * 3_600_000) : 0 },
        evaluateDone,
        onTurn: (t: ConquerTurn) => info(dim(`  turn ${t.n} · ${t.action}${t.action === 'consult' || t.action === 'done-check' ? ` — ${t.detail.slice(0, 80)}` : ''}`)),
      });
    } catch (err) {
      console.log('');
      info(dim(`Conquer failed: ${err instanceof Error ? err.message : String(err)}`));
      info(dim(`Work preserved on ${branch} at ${worktreeCwd}. Remove it later with: agon worktree rm ${branch}`));
      process.exitCode = 1;
      return;
    }

    // Surface the falsifier's findings to the human merge gate — whether or not they
    // blocked. A verified counterexample is shown plainly; an advisory attack (the
    // critic probed but couldn't mechanically break it) gets a one-line pointer to
    // the full log in the run dir.
    const showFalsifier = (): void => {
      if (result.counterexample) {
        info(dim(`Falsifier counterexample: ${result.counterexample}${result.observed ? ` → observed: ${result.observed}` : ''}`));
      }
      if (result.attackText) {
        info(dim(`Adversary falsifier log: ${outputDir} (advisory — review before merging).`));
      }
    };

    console.log('');
    info(`Stopped: ${result.stopReason} · turns ${result.turnsUsed} · consults ${result.consultsRun}`);
    if (!result.done) {
      info(result.doneReason ? `Not verified done — ${result.doneReason}` : 'Did not reach a verified done state. Inspect the isolated worktree + the run log.');
      info(dim(`Work preserved on ${branch} at ${worktreeCwd}.`));
      showFalsifier();
      process.exitCode = 1;
      return;
    }

    info(bold('✓ Conquered — build complete and the done-oracle passed.'));
    const claim = result.lastClaim || '(no claim captured)';
    info(`Claim: ${claim}`);
    showFalsifier();
    if (args.push) {
      const git = (a: string[], t: number) => spawnWithTimeout({ command: 'git', args: a, cwd: worktreeCwd, timeout: t });
      const publication = await publishConquerBranch({
        cwd: worktreeCwd, task: taskStr, expectedBranch: branch, commitBody: () => appendAttribution(claim, config),
        protectedPushBranches: config.protectedPushBranches,
      }, git);
      if (!publication.ok) {
        info(dim(publication.message));
        process.exitCode = 1;
      } else {
        const headBranch = publication.branch;
        info(`Pushed ${headBranch}.`);
        const pr = await prepareConquerPullRequest({ task: taskStr, claim, gate, builder,
          branch: headBranch, base: defaultBaseBranch(root), repoUrl: githubRepoUrl(root) }, {
          git, formatBody: body => appendPrAttribution(body, config),
          draft: async input => {
            const check = (signal?: AbortSignal) => {
              signal?.throwIfAborted();
              assertInvocationCurrent();
              assertProcessSurfaceAvailable('cli', 'conquer');
              assertProcessSurfaceAvailable('cli', 'forge');
            };
            check();
            info(dim(`Writing PR text (${builder})…`));
            const drafted = await runPrText({ ...input, registry, adapter: guardEngineAdapter(adapter, check), timeout: 300, outputDir, cwd: worktreeCwd });
            check();
            if (!drafted.ok) info(dim('PR-text engine call failed — using the templated title + claim.'));
            return drafted;
          },
        });
        console.log('');
        info(bold(pr.title));
        console.log(pr.body);
        console.log('');
        info(pr.mergeHint);
      }
    } else {
      info(dim(`The builder's changes are isolated on ${branch} at ${worktreeCwd}. Review and commit there, then open a PR to merge. Remove it later with: agon worktree rm ${branch}`));
    }
  },
});
