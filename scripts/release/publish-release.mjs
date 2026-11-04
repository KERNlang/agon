#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { publishIfNew } from './publish-if-new.mjs';

const { values } = parseArgs({ options: {
  tarballs: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  provenance: { type: 'boolean', default: false },
} });
if (!values.tarballs) throw new Error('usage: publish-release.mjs --tarballs <dir> [--dry-run] [--provenance]');

const directory = resolve(values.tarballs);
const { packages } = JSON.parse(readFileSync(join(directory, 'release-manifest.json'), 'utf8'));
const options = { dryRun: values['dry-run'], provenance: values.provenance };
const outcome = { published: 0, skipped: 0 };
for (const entry of packages) outcome[publishIfNew(entry, join(directory, entry.filename), options)]++;
console.log(`${options.dryRun ? 'dry-run' : 'release'} complete: ${outcome.published} ${options.dryRun ? 'would publish' : 'published'}, ${outcome.skipped} already on npm, ${packages.length} total`);
