// @kern-source: provenance:6
import { defineCommand } from 'citty';

// @kern-source: provenance:7
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

// @kern-source: provenance:8
import { join } from 'node:path';

// @kern-source: provenance:9
import { RUNS_DIR, ensureAgonHome, buildForgeProvenance, renderProvenanceMarkdown, renderProvenanceJson } from '@agon/core';

// @kern-source: provenance:10
import type { ForgeManifest } from '@agon/core';

// @kern-source: provenance:11
import { info, bold } from '../blocks/output-format.js';

// @kern-source: provenance:13
export const provenanceCommand: any = defineCommand({
  meta: {
    name: 'provenance',
    description: 'AI-contribution / transparency report for a forge run',
  },
  args: {
    id: {
      type: 'string',
      description: 'Forge run ID or prefix (defaults to the most recent run)',
    },
    format: {
      type: 'string',
      alias: 'f',
      description: 'Output register: md | json | both',
      default: 'md',
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Write the report to a file instead of stdout',
    },
  },
  run({ args }) {
    ensureAgonHome();

    // citty hands back an array when a string flag is repeated; collapse.
    const coerce = (v: unknown): string | undefined =>
      typeof v === 'string'
        ? v
        : Array.isArray(v) && v.length > 0
          ? String(v[v.length - 1])
          : undefined;

    // Accept either `--id <x>` or a bare positional `agon provenance <x>`.
    const positional = Array.isArray(args._) && typeof args._[0] === 'string' ? args._[0] : undefined;
    const idArg = coerce(args.id) ?? positional;
    const outArg = coerce(args.out);
    const fmt = (coerce(args.format) ?? 'md').toLowerCase();
    if (fmt !== 'md' && fmt !== 'json' && fmt !== 'both') {
      info(`Unknown format "${fmt}". Use: md, json, or both.`);
      return;
    }

    let files: string[];
    try {
      files = readdirSync(RUNS_DIR).filter((f: string) => f.endsWith('.json'));
    } catch {
      info('No forge runs yet. Run `agon forge` first.');
      return;
    }
    if (files.length === 0) {
      info('No forge runs yet. Run `agon forge` first.');
      return;
    }

    let file: string | undefined;
    if (idArg) {
      // Prefer a prefix match (the natural case: an ID or its prefix); fall
      // back to a looser substring match only when no prefix matches.
      const byPrefix = files.filter((f) => f.startsWith(idArg));
      const matches = byPrefix.length > 0 ? byPrefix : files.filter((f) => f.includes(idArg));
      file = matches.sort().reverse()[0];
      if (!file) {
        info(`Run "${idArg}" not found`);
        return;
      }
    } else {
      file = files.sort().reverse()[0];
    }

    const manifestPath = join(RUNS_DIR, file);
    let manifest: ForgeManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ForgeManifest;
    } catch (e) {
      info(`Could not read run ${file}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (typeof manifest?.forgeId !== 'string' || typeof manifest?.task !== 'string') {
      info(`Run ${file} is missing required fields (forgeId/task) — not a forge manifest.`);
      return;
    }

    let md: string;
    let js: string;
    try {
      const ledger = buildForgeProvenance(manifest, manifestPath);
      md = renderProvenanceMarkdown(ledger);
      js = renderProvenanceJson(ledger);
    } catch (e) {
      info(`Could not build provenance for ${file}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    if (outArg) {
      const payload =
        fmt === 'json'
          ? js
          : fmt === 'both'
            ? `${md}\n\n<!-- JSON LEDGER -->\n\`\`\`json\n${js}\n\`\`\`\n`
            : md;
      writeFileSync(outArg, payload);
      info(`Provenance report written to ${bold(outArg)}`);
      return;
    }

    if (fmt === 'json') {
      console.log(js);
      return;
    }
    if (fmt === 'both') {
      console.log(md);
      console.log('\n--- JSON LEDGER ---\n');
      console.log(js);
      return;
    }
    console.log(md);
  },
});

