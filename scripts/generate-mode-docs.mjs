// Render docs/modes.md from the selected owner-tagged registry generation.
// The physical routing-docs package owns both the renderer and the named
// handwritten prose region; this script is only a build entrypoint.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogPath = process.env.AGON_SURFACE_CATALOG_PATH || join(root, 'packages/mod-kernel/src/generated/first-party-surface-catalog.ts');
const catalogSource = readFileSync(catalogPath, 'utf8');
const prefix = 'Object.freeze(';
const suffix = ') as readonly GeneratedSurfaceCatalogEntry[];';
const start = catalogSource.indexOf(prefix);
const end = catalogSource.lastIndexOf(suffix);
if (start < 0 || end < 0) throw new Error('generated surface catalog is unreadable');
const catalog = JSON.parse(catalogSource.slice(start + prefix.length, end));

const rendererPath = process.env.AGON_DOCS_RENDERER_PATH || join(root, 'packages/mod-routing-docs/dist/index.js');
const { renderModeDocsProjection } = await import(pathToFileURL(rendererPath).href);
const out = process.env.AGON_DOCS_OUTPUT_PATH || join(root, 'docs', 'modes.md');
const existing = existsSync(out) ? readFileSync(out, 'utf8') : '';
const content = renderModeDocsProjection(catalog, existing);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, content);
console.log(`wrote ${out}`);
