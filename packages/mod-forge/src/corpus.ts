import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TaskClass } from '@kernlang/agon-support-engine-runtime';
import type { BreakerArtifact, CorpusEntry, GapPattern } from './types.js';

export interface CorpusRecord {
  entries: CorpusEntry[];
  patterns: GapPattern[];
  lastUpdated: string;
}

export function createForgeCorpus(corpusPath: string) {
  function loadCorpus(): CorpusRecord {
    try {
      return JSON.parse(readFileSync(corpusPath, 'utf-8')) as CorpusRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[agon] failed to load corpus: ${err instanceof Error ? err.message : String(err)}`);
      }
      return { entries: [], patterns: [], lastUpdated: new Date().toISOString() };
    }
  }

  function saveCorpus(record: CorpusRecord): void {
    mkdirSync(dirname(corpusPath), { recursive: true });
    record.lastUpdated = new Date().toISOString();
    const tmpPath = corpusPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(record, null, 2) + '\n');
    renameSync(tmpPath, corpusPath);
  }

  function addToCorpus(forgeId: string, taskClass: TaskClass, artifacts: BreakerArtifact[]): number {
    if (artifacts.length === 0) return 0;

    const record = loadCorpus();
    let added = 0;

    for (const artifact of artifacts) {
      if (!artifact.validated) continue;

      // Extract pattern from failure — normalize to a category
      const pattern = extractPattern(artifact.failureMessage, artifact.testScript);

      const entry: CorpusEntry = {
        forgeId,
        taskClass,
        artifact,
        timestamp: new Date().toISOString(),
        replayCount: 0,
        pattern,
      };

      record.entries.push(entry);
      added++;

      // Update gap patterns
      if (pattern) {
        const existing = record.patterns.find(
          (p) => p.pattern === pattern && p.taskClass === taskClass,
        );
        if (existing) {
          existing.frequency++;
          existing.lastSeen = new Date().toISOString();
        } else {
          record.patterns.push({
            pattern,
            taskClass,
            frequency: 1,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            skillProposed: false,
          });
        }
      }
    }

    // Prune old entries — keep last 200
    if (record.entries.length > 200) {
      record.entries = record.entries.slice(-200);
    }

    saveCorpus(record);
    return added;
  }

  function extractPattern(failureMessage: string, testScript: string): string|undefined {
    // Normalize common failure patterns into categories
    const combined = (failureMessage + ' ' + testScript).toLowerCase();

    const patterns: [RegExp, string][] = [
      [/null|undefined|cannot read prop/, 'null-handling'],
      [/boundary|edge.?case|off.?by.?one|overflow/, 'boundary-condition'],
      [/empty.?(string|array|object|input)|length.?===?\s*0/, 'empty-input'],
      [/type.?error|type.?coercion|nan\b|infinity/, 'type-safety'],
      [/race.?condition|concurrent|deadlock|async/, 'concurrency'],
      [/timeout|hang|infinite.?loop/, 'timeout-handling'],
      [/injection|xss|escap|sanitiz/, 'security-injection'],
      [/encoding|utf|unicode|charset/, 'encoding'],
      [/permission|auth|forbidden|unauthorized/, 'auth-boundary'],
      [/large.?input|performance|memory|oom/, 'scale-handling'],
    ];

    for (const [regex, label] of patterns) {
      if (regex.test(combined)) return label;
    }

    return undefined;
  }

  function getCorpusForReplay(taskClass: TaskClass, limit: number): CorpusEntry[] {
    const record = loadCorpus();

    // Filter entries matching task class, sort by most recent
    const matching = record.entries
      .filter((e) => e.taskClass === taskClass && e.artifact.validated)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    // Update the selected records. Run and engine IDs are not unique.
    for (const entry of matching) {
      entry.replayCount++;
    }

    if (matching.length > 0) saveCorpus(record);

    return matching;
  }

  function getGapPatterns(taskClass?: TaskClass, threshold?: number): GapPattern[] {
    const record = loadCorpus();
    const minFreq = threshold ?? 3;
    return record.patterns.filter((p) => p.frequency >= minFreq && !p.skillProposed).filter((p) => !taskClass || p.taskClass === taskClass).sort((a, b) => b.frequency - a.frequency);
  }


  function getCorpusStats(): { totalEntries: number, totalPatterns: number, topPatterns: { pattern: string, frequency: number, taskClass: string }[] } {
    const record = loadCorpus();
    return { totalEntries: record.entries.length, totalPatterns: record.patterns.length, topPatterns: record.patterns.sort((a, b) => b.frequency - a.frequency).slice(0, 10).map((p) => Object.assign({}, { pattern: p.pattern, frequency: p.frequency, taskClass: p.taskClass })) };
  }

  return { loadCorpus, saveCorpus, addToCorpus, extractPattern, getCorpusForReplay, getGapPatterns, getCorpusStats };
}
