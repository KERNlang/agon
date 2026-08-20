// Static gap checks for the FastAPI service source.

import { existsSync, readFileSync } from 'node:fs';

import { join } from 'node:path';

export type FastApiGap = { id: string; severity: 'blocking' | 'important'; message: string };

export type FastApiGapReport = { ok: boolean; gaps: FastApiGap[]; checkedFiles: string[] };

/**
 * Static checks for known @kernlang/python output gaps Agon currently works around or cannot run through.
 */
export function analyzeFastApiSource(sourceDir: string): FastApiGapReport {
  const gaps: FastApiGap[] = [];
  const checkedFiles: string[] = [];
  const healthPath = join(sourceDir, 'health.py');
  const routePath = join(sourceDir, 'routes', 'get_health.py');

  if (!existsSync(healthPath)) {
    gaps.push({
      id: 'fastapi-entrypoint-missing',
      severity: 'blocking',
      message: `Missing generated FastAPI entrypoint: ${healthPath}`,
    });
    return { ok: false, gaps, checkedFiles };
  }

  checkedFiles.push(healthPath);
  const health = readFileSync(healthPath, 'utf-8');

  if (health.startsWith('// @generated')) {
    gaps.push({
      id: 'python-header-comment',
      severity: 'blocking',
      message: 'Generated Python still has a TypeScript-style // header.',
    });
  }

  const importsRoute = /from\s+routes\.get_health\s+import\s+router\s+as\s+get_health_router/.test(health);
  const includesRoute = /app\.include_router\(get_health_router\)/.test(health);
  if ((importsRoute || includesRoute) && !existsSync(routePath)) {
    gaps.push({
      id: 'fastapi-route-module-missing',
      severity: 'blocking',
      message: `Entrypoint references routes.get_health, but ${routePath} was not emitted.`,
    });
  } else if (existsSync(routePath)) {
    checkedFiles.push(routePath);
  }

  if (/uvicorn\.run\([^)]*host=["']0\.0\.0\.0["']/.test(health) && !/os\.environ\.get\(["'](?:HOST|BIND_HOST|AGON_HOST)["']/.test(health)) {
    gaps.push({
      id: 'fastapi-unsafe-bind-host',
      severity: 'important',
      message: 'Generated uvicorn entrypoint binds to 0.0.0.0 without an env override.',
    });
  }

  if (/allow_credentials=True/.test(health) && (/allow_methods=\[\s*["']\*["']\s*\]/.test(health) || /allow_headers=\[\s*["']\*["']\s*\]/.test(health))) {
    gaps.push({
      id: 'fastapi-cors-wildcard-credentials',
      severity: 'important',
      message: 'Generated CORS config combines credentials with wildcard methods or headers.',
    });
  }

  if (/CORS_ORIGINS["'],\s*["']["']/.test(health)) {
    gaps.push({
      id: 'fastapi-empty-cors-default',
      severity: 'important',
      message: 'Generated CORS config defaults CORS_ORIGINS to empty string, yielding allow_origins=[].',
    });
  }

  if (/\n\s+from\s+fastapi\.responses\s+import\s+JSONResponse/.test(health)) {
    gaps.push({
      id: 'fastapi-lazy-jsonresponse-import',
      severity: 'important',
      message: 'Generated exception handler imports JSONResponse inside the hot error path.',
    });
  }

  return { ok: gaps.length === 0, gaps, checkedFiles };
}

export function formatFastApiGapReport(report: FastApiGapReport): string {
  if (report.ok) {
    return `FastAPI generated output passed ${report.checkedFiles.length} gap checks.`;
  }
  const lines = [
    `FastAPI generated output still has ${report.gaps.length} known gap${report.gaps.length === 1 ? '' : 's'}:`,
    ...report.gaps.map((gap) => `- [${gap.severity}] ${gap.id}: ${gap.message}`),
  ];
  return lines.join('\n');
}

export function checkFastApiSourceCli(sourceDir?: string): number {
  const targetDir = sourceDir || process.argv[2] || 'src/generated';
  const report = analyzeFastApiSource(targetDir);
  const text = formatFastApiGapReport(report);
  if (report.ok) {
    console.log(text);
    return 0;
  }
  console.error(text);
  return 1;
}
