import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const roadmap = JSON.parse(readFileSync(`${root}/docs/specs/evidence/modular-agon-implementation-roadmap.json`, 'utf8'));
const scripts = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).scripts ?? {};
const headResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (headResult.status !== 0) throw new Error(headResult.stderr || 'cannot resolve HEAD');
const subjectCommit = headResult.stdout.trim();

function commandAvailability(command) {
  const npmMatch = /^npm run ([^ ]+)$/.exec(command);
  if (npmMatch) return { command, available: typeof scripts[npmMatch[1]] === 'string', reason: scripts[npmMatch[1]] ? 'package-script-present' : `missing package script ${npmMatch[1]}` };
  const nodeMatch = /^node ([^ ]+)(?: .*)?$/.exec(command);
  if (nodeMatch) return { command, available: existsSync(`${root}/${nodeMatch[1]}`), reason: existsSync(`${root}/${nodeMatch[1]}`) ? 'entrypoint-present' : `missing entrypoint ${nodeMatch[1]}` };
  return { command, available: false, reason: 'unsupported acceptance command form' };
}
function receiptFor(slice) {
  const path = `${root}/docs/specs/evidence/receipts/modular-agon-${slice.id.toLowerCase()}.json`;
  if (!existsSync(path)) return { path, valid: false, reason: 'missing clean execution receipt' };
  try {
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    const commandsMatch = JSON.stringify(receipt.commands) === JSON.stringify(slice.acceptanceCommands);
    return { path, valid: receipt.passed === true && receipt.cleanWorktree === true && receipt.subjectCommit === subjectCommit && commandsMatch, reason: 'receipt must pass, identify clean HEAD, and list exact commands' };
  } catch (error) { return { path, valid: false, reason: `invalid receipt: ${error.message}` }; }
}

const assessed = [];
for (const slice of roadmap.slices) {
  const dependenciesReady = slice.dependsOn.every((id) => assessed.find((entry) => entry.id === id)?.ready === true);
  const commands = slice.acceptanceCommands.map(commandAvailability);
  const receipt = receiptFor(slice);
  assessed.push({ id: slice.id, dependenciesReady, commands, receipt, ready: dependenciesReady && commands.every(({ available }) => available) && receipt.valid });
}
console.log(JSON.stringify({ schemaVersion: 1, subjectCommit, slices: assessed, readySlices: assessed.filter(({ ready }) => ready).map(({ id }) => id) }, null, 2));
if (assessed.some(({ ready }) => !ready)) process.exitCode = 1;
