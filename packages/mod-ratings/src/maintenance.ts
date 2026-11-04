import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { withFileLock } from '@kernlang/agon-support-persistence';

export interface MaintenanceRecord {
  global?: Record<string, unknown>;
  byMode?: Record<string, Record<string, unknown>>;
  byTaskClass?: Record<string, Record<string, unknown>>;
  engineMeta?: Record<string, { derivedFrom?: string | null; versions?: string[] }>;
}

export interface RatingsMaintenanceStore<T extends MaintenanceRecord> {
  path: (...parts: string[]) => string;
  load: () => T;
  save: (record: T) => void;
}

export interface RunManifest {
  file: string;
  engines: string[];
  hasEnginesField?: boolean;
}

export interface PurgeReport {
  dryRun: boolean;
  keepCount: number;
  ratingsPath: string;
  ratingsUnknown: string[];
  ratingsRemoved: string[];
  runsScanned: number;
  runsPurged: Array<{ file: string; engines: string[] }>;
  backupDir: string | null;
}

export function computeUnknownEngineIds<T extends MaintenanceRecord>(record: T, keepIds: string[]): string[] {
  const keep = new Set(keepIds);
  const ids = new Set<string>();
  for (const scope of [record.global, record.engineMeta, ...Object.values(record.byMode ?? {}), ...Object.values(record.byTaskClass ?? {})]) {
    for (const id of Object.keys(scope ?? {})) ids.add(id);
  }
  return [...ids].filter(id => !keep.has(id)).sort();
}

function pruneRatingIds(record: MaintenanceRecord, ids: string[]): string[] {
  const remove = new Set(ids);
  const removed = new Set<string>();
  for (const scope of [record.global, record.engineMeta, ...Object.values(record.byMode ?? {}), ...Object.values(record.byTaskClass ?? {})]) {
    for (const id of Object.keys(scope ?? {})) {
      if (remove.has(id)) { delete scope![id]; removed.add(id); }
    }
  }
  for (const meta of Object.values(record.engineMeta ?? {})) {
    if (meta.derivedFrom && remove.has(meta.derivedFrom)) meta.derivedFrom = null;
    if (Array.isArray(meta.versions)) meta.versions = meta.versions.filter(id => !remove.has(id));
  }
  return [...removed].sort();
}

export function computeRunManifestPurge(manifests: RunManifest[], keepIds: string[]): string[] {
  const keep = new Set(keepIds);
  return manifests.filter(manifest => manifest.hasEnginesField !== false
    && !(Array.isArray(manifest.engines) ? manifest.engines : []).some(id => keep.has(id)))
    .map(manifest => manifest.file).sort();
}

function readRunManifest(directory: string, file: string): RunManifest {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, file), 'utf8'));
    return { file, engines: Array.isArray(manifest?.engines) ? manifest.engines.filter((id: unknown): id is string => typeof id === 'string') : [],
      hasEnginesField: Array.isArray(manifest?.engines) };
  } catch { return { file, engines: [], hasEnginesField: false }; }
}

function readRunManifests(directory: string): RunManifest[] {
  let names: string[];
  try { names = readdirSync(directory).filter(file => file.endsWith('.json')); }
  catch { return []; }
  return names.map(file => readRunManifest(directory, file));
}

/** Keep storage codecs with their caller. This owner controls selection and mutation. */
export function purgeRatingsStore<T extends MaintenanceRecord>(
  opts: { registryIds: string[]; extraKeepIds?: string[]; dryRun: boolean },
  store: RatingsMaintenanceStore<T>,
): { report: PurgeReport; backupCandidate: string | null } {
  const keep = [...new Set([...(opts.registryIds ?? []), ...(opts.extraKeepIds ?? [])])];
  const ratingsFile = store.path('ratings.json');
  const runsDir = store.path('runs');
  const unknown = computeUnknownEngineIds(store.load(), keep);
  const manifests = readRunManifests(runsDir);
  const candidates = new Set(computeRunManifestPurge(manifests, keep));
  const purgeRuns = manifests.filter(manifest => candidates.has(manifest.file));
  const report: PurgeReport = { dryRun: opts.dryRun, keepCount: keep.length, ratingsPath: ratingsFile,
    ratingsUnknown: unknown, ratingsRemoved: [], runsScanned: manifests.length, runsPurged: purgeRuns, backupDir: null };
  if (opts.dryRun) return { report, backupCandidate: null };

  let backupCandidate = store.path(`purge-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const ensureBackup = () => {
    if (!report.backupDir) {
      mkdirSync(dirname(backupCandidate), { recursive: true });
      backupCandidate = mkdtempSync(backupCandidate + '-');
      report.backupDir = backupCandidate;
    }
    return backupCandidate;
  };
  report.ratingsUnknown = [];
  withFileLock(ratingsFile + '.lock', () => {
    if (!existsSync(ratingsFile)) return;
    const current = store.load();
    const ids = computeUnknownEngineIds(current, keep);
    report.ratingsUnknown = ids;
    if (!ids.length) return;
    copyFileSync(ratingsFile, join(ensureBackup(), 'ratings.json'));
    report.ratingsRemoved = pruneRatingIds(current, ids);
    store.save(current);
  });
  report.runsPurged = [];
  if (purgeRuns.length) {
    const destination = join(ensureBackup(), 'runs');
    mkdirSync(destination, { recursive: true });
    for (const manifest of purgeRuns) {
      try {
        withFileLock(join(runsDir, manifest.file) + '.lock', () => {
          const current = readRunManifest(runsDir, manifest.file);
          if (!computeRunManifestPurge([current], keep).length) return;
          renameSync(join(runsDir, manifest.file), join(destination, manifest.file));
          report.runsPurged.push(current);
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new Error(`Ratings purge stopped while moving ${manifest.file}. Earlier changes have backups in ${backupCandidate}.`, { cause: error });
        }
      }
    }
  }
  return { report, backupCandidate };
}
