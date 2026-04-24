#!/usr/bin/env node
/**
 * Confidence calibration tracker.
 * Logs (taskId, reportedConfidence, actualOutcome) to JSONL.
 * CLI: npx agon confidence-report
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'confidence.jsonl');

function now() {
  return new Date().toISOString();
}

export function logConfidence({ taskId, confidence, mode, taskClass, outcome, notes = '' }) {
  const entry = { ts: now(), taskId, confidence, mode, taskClass, outcome, notes };
  fs.appendFileSync(DB_PATH, JSON.stringify(entry) + '\n', 'utf8');
}

export function report() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('No confidence data yet.');
    return;
  }
  const lines = fs.readFileSync(DB_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const records = [];
  for (const [i, line] of lines.entries()) {
    try {
      records.push(JSON.parse(line));
    } catch {
      console.warn(`  Skipping malformed line ${i + 1}: ${line.slice(0, 60)}...`);
    }
  }

  const buckets = {};
  for (const r of records) {
    const bucket = Math.floor(r.confidence / 10) * 10;
    buckets[bucket] = buckets[bucket] || { total: 0, success: 0 };
    buckets[bucket].total++;
    if (r.outcome === 'success') buckets[bucket].success++;
  }

  console.log('\n=== Confidence Calibration Report ===\n');
  console.log(`Total tasks: ${records.length}`);
  for (const [bucket, stats] of Object.entries(buckets).sort((a, b) => a[0] - b[0])) {
    const actual = ((stats.success / stats.total) * 100).toFixed(1);
    console.log(`  ${bucket}%–${+bucket + 9}% confidence → ${stats.success}/${stats.total} success (${actual}% actual)`);
  }
  console.log('');
}

// CLI entry
if (process.argv[1] === __filename || process.argv[1].endsWith('confidence-tracker.mjs')) {
  report();
}
