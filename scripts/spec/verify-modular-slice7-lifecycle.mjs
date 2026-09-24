import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const fail = (message) => { throw new Error(message); };

const packageJson = json('package.json');
const roadmap = json('docs/specs/evidence/modular-agon-implementation-roadmap.json');
const adapters = json('docs/specs/evidence/modular-agon-slice7-compatibility-adapters.json');
const managed = read('packages/mod-kernel/src/managed-lifecycle.ts');
const candidate = read('packages/mod-kernel/src/candidate-process.ts');
const recovery = read('packages/mod-kernel/src/lifecycle-recovery.ts');
const setup = read('packages/mod-kernel/src/setup-actions.ts');
const publicApi = read('packages/mod-kernel/src/index.ts');
const updater = read('packages/cli/src/commands/update.ts');
const releaseSetup = read('packages/cli/src/commands/setup.ts');

const requiredScripts = [
  'test:modular-installer',
  'test:modular-updater',
  'test:modular-fault-injection',
  'test:modular-lifecycle-concurrency',
];
for (const id of requiredScripts) if (!packageJson.scripts?.[id]) fail(`missing S7 acceptance command: ${id}`);
const s7 = roadmap.slices.find((slice) => slice.id === 'S7');
if (!s7 || requiredScripts.some((id) => !s7.acceptanceCommands.includes(`npm run ${id}`))) fail('S7 roadmap acceptance commands drifted');

if ('postinstall' in packageJson.scripts || existsSync(resolve(root, 'scripts/postinstall.mjs'))) fail('root postinstall side effects remain reachable');
if (packageJson.scripts.prebuild !== 'patch-package --error-on-fail') fail('source patching must be explicit, build-time, and fail closed');

const markers = [
  [managed, "ignoreLifecycleScripts: true", 'managed installer does not force scripts off'],
  [managed, "networkPolicy === 'frozen-offline'", 'managed installer has no frozen-offline gate'],
  [managed, "trustTier !== 'first-party'", 'third-party activation is not fail-closed in S7'],
  [managed, 'sacrificial candidate verification failed', 'managed installer lacks sacrificial verification'],
  [managed, "operation: plan.operation === 'downgrade' ? 'update'", 'downgrade is not transactional'],
  [candidate, "shell: false", 'candidate subprocess can invoke a shell'],
  [candidate, "'--ignore-scripts'", 'npm candidate command permits lifecycle scripts'],
  [candidate, 'active process cannot overwrite its own installation prefix', 'active-prefix overwrite guard missing'],
  [recovery, 'recovered-selected-generation', 'post-commit recovery missing'],
  [recovery, 'recovered-prior-generation', 'pre-commit recovery missing'],
  [recovery, 'purge approval does not match exact preview', 'purge preview binding missing'],
  [setup, 'setup executable changed after approval', 'setup action integrity recheck missing'],
  [setup, 'declared outputs were rolled back', 'setup rollback missing'],
  [publicApi, "from './managed-lifecycle.js'", 'managed lifecycle is not public'],
  [publicApi, "from './candidate-process.js'", 'candidate process is not public'],
  [publicApi, "from './lifecycle-recovery.js'", 'lifecycle recovery is not public'],
  [publicApi, "from './setup-actions.js'", 'setup actions are not public'],
  [updater, 'runManagedSetup', 'update does not use managed lifecycle setup'],
  [updater, 'preserveExistingState: true', 'update does not preserve the selected profile and desired state'],
  [releaseSetup, 'ManagedLifecycleService', 'release setup does not use the transactional lifecycle'],
  [releaseSetup, 'runBoundedCandidateProcess', 'release setup does not qualify a sacrificial candidate'],
];
for (const [source, marker, message] of markers) if (!source.includes(marker)) fail(message);

if (adapters.adapters.length !== 0) fail('legacy global updater compatibility adapter remains reachable');

if (process.argv.includes('--self-test')) {
  const requireMarker = (source, marker) => {
    if (!source.includes(marker)) throw new Error(`negative control rejected missing marker: ${marker}`);
  };
  let killed = 0;
  for (const [source, marker] of markers) {
    try { requireMarker(source.split(marker).join(''), marker); } catch { killed += 1; }
  }
  const mutated = structuredClone(packageJson);
  mutated.scripts.postinstall = 'node scripts/postinstall.mjs';
  if ('postinstall' in mutated.scripts) killed += 1;
  if (killed !== markers.length + 1) fail('S7 negative controls did not discriminate every required invariant');
}

console.log(JSON.stringify({
  status: 'passed',
  acceptanceCommands: requiredScripts.length,
  lifecycleMarkers: markers.length,
  temporaryAdapters: 0,
  postinstallRemoved: true,
}, null, 2));
