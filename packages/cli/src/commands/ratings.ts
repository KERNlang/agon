import { defineCommand } from 'citty';

import { EngineRegistry, loadConfig, ensureAgonHome, purgeUnknownEngineData, applyRatingsReset } from '@kernlang/agon-core';

import { resolveBuiltinEnginesDir } from '../lib/engines-dir.js';

import { header, info, success, table, bold, green, red, dim } from '../blocks/output-format.js';

/**
 * Maintenance for the Glicko ratings + forge-run history store.
 */
export const ratingsCommand: any = defineCommand({
  meta: {
    name: 'ratings',
    description: 'Maintain the Glicko ratings + forge-run history store (purge-unknown, reset)',
  },
  subCommands: {
    'purge-unknown': defineCommand({
      meta: {
        name: 'purge-unknown',
        description: 'Remove rating + forge-run-history records for engine ids that are not real (registered) engines — e.g. `fast`/`slow`/`e1` test doubles that leaked into the store. Dry-run by default.',
      },
      args: {
        apply: {
          type: 'boolean',
          description: 'Actually perform the purge. Without it (or with --dry-run) the command only PREVIEWS what would be removed.',
          default: false,
        },
        'dry-run': {
          type: 'boolean',
          description: 'Preview only — list what would be removed and write nothing. This is the default; --apply is required to write.',
          default: false,
        },
        keep: {
          type: 'string',
          description: 'Comma-separated extra engine ids to NEVER remove even if unregistered (legacy/renamed real engines). Unioned with config.ratingsPurgeKeepEngines.',
        },
      },
      run({ args }) {
        ensureAgonHome();
        const config = loadConfig();

        // Real-engine keep set = every registered engine (builtin + user).
        const registry = new EngineRegistry();
        registry.load(resolveBuiltinEnginesDir());
        const registryIds = registry.listIds();

        // Extra keep list: config.ratingsPurgeKeepEngines ∪ --keep. Protects
        // genuinely-real engines that no longer have a live registry def
        // (renamed like gemini→agy, drifted version ids like kimi-for-coding-k2p6).
        const rawKeep = typeof args.keep === 'string' ? args.keep : Array.isArray(args.keep) ? args.keep.join(',') : '';
        const cliKeep = rawKeep.split(',').map((s: string) => s.trim()).filter(Boolean);
        const configKeep = Array.isArray((config as any).ratingsPurgeKeepEngines) ? (config as any).ratingsPurgeKeepEngines as string[] : [];
        const extraKeepIds = Array.from(new Set([...configKeep, ...cliKeep]));

        // Default is dry-run; --apply is the only way to write. --dry-run
        // forces preview even if --apply is also (accidentally) passed.
        const dryRun = args['dry-run'] === true || args.apply !== true;

        const report = purgeUnknownEngineData({ registryIds, extraKeepIds, dryRun });

        header(dryRun ? 'Ratings purge — DRY RUN (nothing written)' : 'Ratings purge — APPLIED');
        info(`Keep set: ${report.keepCount} real engine ids (registry + ${extraKeepIds.length} extra)`);
        console.log('');

        // Ratings candidates
        if (report.ratingsUnknown.length === 0) {
          info(green('Ratings store clean — no unknown engine ids.'));
        } else {
          header(dryRun ? `Would remove ${report.ratingsUnknown.length} rating id(s)` : `Removed ${report.ratingsRemoved.length} rating id(s)`);
          table(['Engine id'], report.ratingsUnknown.map((id: string) => [red(id)]));
        }

        console.log('');
        // Run-history candidates
        if (report.runsPurged.length === 0) {
          info(green(`Forge-run history clean — ${report.runsScanned} run(s) scanned, none purgeable.`));
        } else {
          header(dryRun
            ? `Would remove ${report.runsPurged.length} of ${report.runsScanned} forge-run manifest(s)`
            : `Removed ${report.runsPurged.length} of ${report.runsScanned} forge-run manifest(s)`);
          table(['Run file', 'Engines'], report.runsPurged.map((r: { file: string; engines: string[] }) => [
            dim(r.file.slice(0, 20)),
            r.engines.length ? red(r.engines.join(', ')) : dim('(none)'),
          ]));
        }

        console.log('');
        if (dryRun) {
          if (report.ratingsUnknown.length > 0 || report.runsPurged.length > 0) {
            info(bold('Re-run with --apply to remove these. A timestamped backup is written before any change.'));
          }
        } else {
          success('Purge applied.');
          if (report.backupDir) info(dim(`Backup (pre-purge ratings.json copy + moved run manifests): ${report.backupDir}`));
          info(dim('Backups are reversible — the pre-purge ratings.json is copied and purged run manifests are MOVED, not deleted.'));
        }
      },
    }),
    reset: defineCommand({
      meta: {
        name: 'reset',
        description: 'Reset the per-discipline (byMode) ratings of the given modes to the default rating, for every engine or only --engines. Global, other modes, byTaskClass and engineMeta are left unchanged. Dry-run by default; --apply writes ratings.json.bak-<timestamp> first.',
      },
      args: {
        modes: {
          type: 'string',
          description: 'Comma-separated disciplines to reset: forge, brainstorm, tribunal, critique.',
        },
        engines: {
          type: 'string',
          description: 'Comma-separated engine ids to reset; default is every engine rated in those modes.',
        },
        apply: {
          type: 'boolean',
          description: 'Actually reset. Without it the command only previews the entries it would reset.',
          default: false,
        },
      },
      run({ args }) {
        ensureAgonHome();
        const csv = (value: unknown) => String(typeof value === 'string' ? value : '').split(',').map((s: string) => s.trim()).filter(Boolean);
        const modes = csv(args.modes);
        const engines = csv(args.engines);
        if (modes.length === 0) {
          console.error(red('--modes is required (forge, brainstorm, tribunal, critique).'));
          process.exitCode = 1;
          return;
        }
        const report = applyRatingsReset({ modes, engines: engines.length > 0 ? engines : undefined, apply: args.apply === true });
        if (report.unknownModes.length > 0 || report.unknownEngines.length > 0) {
          if (report.unknownModes.length > 0) console.error(red(`Unknown mode(s): ${report.unknownModes.join(', ')} — use forge, brainstorm, tribunal or critique.`));
          if (report.unknownEngines.length > 0) console.error(red(`Unknown engine(s), not rated in ${modes.join(', ')}: ${report.unknownEngines.join(', ')}.`));
          info('Nothing written.');
          process.exitCode = 1;
          return;
        }
        header(report.dryRun ? 'Ratings reset — DRY RUN (nothing written)' : 'Ratings reset — APPLIED');
        if (report.entries.length === 0) {
          info(green(`No ratings in ${modes.join(', ')} to reset.`));
          return;
        }
        table(['Mode', 'Engine', 'mu', 'phi', 'W-L'], report.entries.map((e) => [
          e.mode, bold(e.engineId), String(e.before.mu), String(e.before.phi), `${e.before.wins}-${e.before.losses}`,
        ]));
        console.log('');
        if (report.dryRun) {
          info(bold(`Re-run with --apply to reset these ${report.entries.length} entries. A timestamped backup is written before any change.`));
        } else {
          success(`Reset ${report.entries.length} entries to the default rating.`);
          if (report.backupPath) info(dim(`Backup: ${report.backupPath}`));
        }
      },
    }),
  },
});
