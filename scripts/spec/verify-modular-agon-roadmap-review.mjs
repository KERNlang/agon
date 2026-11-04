import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const receiptPath = join(root, 'docs/specs/evidence/modular-agon-roadmap-review-receipt.json');
const hashPath = join(root, 'docs/specs/evidence/modular-agon-roadmap-review/hashes.json');
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const manifest = JSON.parse(readFileSync(hashPath, 'utf8'));
const errors = [];
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const artifact of receipt.subjectArtifacts) {
  const path = join(root, artifact.path);
  if (!existsSync(path) || digest(path) !== artifact.sha256) errors.push(`subject hash mismatch: ${artifact.path}`);
}
for (const artifact of manifest.artifacts) {
  const path = join(dirname(hashPath), artifact.path);
  if (!existsSync(path) || digest(path) !== artifact.hash) errors.push(`review artifact hash mismatch: ${artifact.path}`);
}
if (receipt.disposition !== 'passed-after-adjudication') errors.push('review disposition is not passed-after-adjudication');
if (!Array.isArray(receipt.unresolvedLocallyFixableFindings) || receipt.unresolvedLocallyFixableFindings.length > 0) errors.push('review has unresolved local findings');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(JSON.stringify({ subjectArtifacts: receipt.subjectArtifacts.length, reviewArtifacts: manifest.artifacts.length, resolvedFindings: receipt.resolvedFindings.length, status: 'passed' }, null, 2));
