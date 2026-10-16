import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectSubjectContamination, hashGitSubject, isSourceBearingPath } from './slice1b-qualification-gates.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const headResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (headResult.status !== 0) throw new Error(headResult.stderr || 'cannot resolve HEAD');
const subjectCommit = headResult.stdout.trim();
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
const committedJson = (path) => {
  const result = git('show', `${subjectCommit}:${path}`);
  if (result.status !== 0) throw new Error(`missing committed evidence: ${path}`);
  return JSON.parse(result.stdout);
};
const roadmap = committedJson('docs/specs/evidence/modular-agon-implementation-roadmap.json');
const scripts = committedJson('package.json').scripts ?? {};
const sliceIds = ['S1B', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];
const receiptPath = id => `docs/specs/evidence/receipts/modular-agon-${id.toLowerCase()}.json`;
const excludedPaths = sliceIds.map(receiptPath);
const roadmapValid = Array.isArray(roadmap.slices) && roadmap.slices.length === sliceIds.length
  && roadmap.slices.every((slice, index) => slice?.id === sliceIds[index]
    && JSON.stringify(slice.dependsOn) === JSON.stringify(index ? [sliceIds[index - 1]] : [])
    && Array.isArray(slice.acceptanceCommands) && slice.acceptanceCommands.length > 0
    && slice.acceptanceCommands.every(command => typeof command === 'string' && command.trim().length > 0));
const subjectHash = hashGitSubject(root, { kind: 'commit', revision: subjectCommit, pathspecs: ['.'], excludedPaths });
const status = git('status', '--porcelain', '--untracked-files=all');
const contamination = collectSubjectContamination(root, ['.']);
const cleanWorktree = status.status === 0 && status.stdout.trim() === ''
  && contamination.ignored.filter(path => isSourceBearingPath(path)).length === 0;

function commandAvailability(command) {
  const npmMatch = /^npm run ([^ ]+)$/.exec(command);
  if (npmMatch) return { command, available: typeof scripts[npmMatch[1]] === 'string', reason: scripts[npmMatch[1]] ? 'package-script-present' : `missing package script ${npmMatch[1]}` };
  const nodeMatch = /^node ([^ ]+)(?: .*)?$/.exec(command);
  if (nodeMatch) {
    const entry = git('cat-file', '-t', `${subjectCommit}:${nodeMatch[1]}`);
    const available = entry.status === 0 && entry.stdout.trim() === 'blob';
    return { command, available, reason: available ? 'committed-entrypoint-present' : `missing committed entrypoint ${nodeMatch[1]}` };
  }
  return { command, available: false, reason: 'unsupported acceptance command form' };
}
function receiptFor(slice) {
  const path = receiptPath(slice.id);
  try {
    const receipt = committedJson(path);
    const commandsMatch = JSON.stringify(receipt.commands) === JSON.stringify(slice.acceptanceCommands);
    if (receipt.schemaVersion !== 2 || !/^[a-f0-9]{40,64}$/.test(receipt.subjectCommit ?? '')) {
      return { path, valid: false, reason: 'receipt requires schema 2 and an immutable tested commit' };
    }
    const ancestor = git('merge-base', '--is-ancestor', receipt.subjectCommit, subjectCommit);
    const testedHash = hashGitSubject(root, { kind: 'commit', revision: receipt.subjectCommit, pathspecs: ['.'], excludedPaths });
    const prerequisites = receipt.prerequisites;
    const prerequisitesMatch = prerequisites !== null && typeof prerequisites === 'object' && !Array.isArray(prerequisites)
      && JSON.stringify(Object.keys(prerequisites).sort()) === JSON.stringify([...slice.dependsOn].sort())
      && slice.dependsOn.every(id => {
        const expected = prerequisites[id];
        if (typeof expected !== 'string' || !/^[a-f0-9]{40,64}$/.test(expected)) return false;
        return [receipt.subjectCommit, subjectCommit].every(revision => {
          const object = git('rev-parse', `${revision}:${receiptPath(id)}`);
          return object.status === 0 && object.stdout.trim() === expected;
        });
      });
    const valid = cleanWorktree && receipt.passed === true && receipt.cleanWorktree === true
      && ancestor.status === 0 && receipt.subjectHash === subjectHash && testedHash === subjectHash && commandsMatch && prerequisitesMatch;
    return { path, valid, reason: valid ? 'committed receipt matches tested source and exact commands'
      : 'receipt must pass, bind tested source and prior receipts, list exact commands, and qualify a clean worktree' };
  } catch (error) { return { path, valid: false, reason: `invalid receipt: ${error.message}` }; }
}

const assessed = [];
for (const slice of roadmapValid ? roadmap.slices : []) {
  const dependenciesReady = slice.dependsOn.every((id) => assessed.find((entry) => entry.id === id)?.ready === true);
  const commands = slice.acceptanceCommands.map(commandAvailability);
  const receipt = receiptFor(slice);
  assessed.push({ id: slice.id, dependenciesReady, commands, receipt, ready: dependenciesReady && commands.every(({ available }) => available) && receipt.valid });
}
console.log(JSON.stringify({ schemaVersion: 2, evidenceCommit: subjectCommit, subjectHash, cleanWorktree, roadmapValid, slices: assessed, readySlices: assessed.filter(({ ready }) => ready).map(({ id }) => id) }, null, 2));
if (!roadmapValid || !cleanWorktree || assessed.some(({ ready }) => !ready)) process.exitCode = 1;
