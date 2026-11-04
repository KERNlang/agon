import { LAUNCHER } from './release-plan.mjs';

export const NOT_INSTALLED = new Map();
export const NOT_PINNED = new Map([[LAUNCHER, 'the channel ships inside the launcher tarball, so it cannot pin its own hash']]);
export const NOT_IN_UPDATE_PLAN = new Map([
  [LAUNCHER, 'the plan records it under lifecycle.launcher'],
  ['@kernlang/agon-dedup', 'compatibility artifact installed by npm, never staged by the kernel'],
]);

export function setDifferences(label, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return [
    ...[...expectedSet].filter((name) => !actualSet.has(name)).map((name) => `${label} lacks ${name}`),
    ...[...actualSet].filter((name) => !expectedSet.has(name)).map((name) => `${label} has unexpected ${name}`),
  ];
}

export function expectedNames(entries, exceptions) {
  return entries.map(({ name }) => name).filter((name) => !exceptions.has(name));
}

export function channelProblems(channel, entries) {
  const pins = [...channel.packages, ...channel.compatibilityArtifacts];
  const problems = setDifferences('channel', pins.map(({ id }) => id), expectedNames(entries, NOT_PINNED));
  for (const { id, version, integrity } of pins) {
    const packed = entries.find(({ name }) => name === id);
    if (packed && (packed.version !== version || packed.integrity !== integrity)) problems.push(`${id} pin differs from its tarball`);
  }
  return problems;
}

export function updatePlanProblems(plan, launcher, entries) {
  if (plan?.status !== 'planned' || !plan.lifecycle) return ['status is not planned'];
  const { version } = launcher;
  const { lifecycle } = plan;
  const problems = [];
  if (plan.launcherSpec !== `${LAUNCHER}@${version}`) problems.push(`launcherSpec ${plan.launcherSpec}`);
  for (const [field, value] of [['kernelVersion', lifecycle.kernelVersion], ['apiVersion', lifecycle.apiVersion], ['launcher.version', lifecycle.launcher?.version]]) {
    if (value !== version) problems.push(`${field} ${value}`);
  }
  if (!lifecycle.planHash) problems.push('no planHash');
  if (lifecycle.missing?.length !== 0) problems.push(`missing ${lifecycle.missing}`);
  const expected = expectedNames(entries, NOT_IN_UPDATE_PLAN);
  const planned = lifecycle.packages ?? [];
  problems.push(...setDifferences('plan packages', planned.map(({ id }) => id), expected));
  problems.push(...setDifferences('plan request', lifecycle.requestedPackageIds ?? [], expected));
  // Lock entries identify mods by mod id (agon.ask), so only sourceLocator names the package.
  problems.push(...setDifferences('plan lock', (lifecycle.lock?.packages ?? []).map(({ sourceLocator }) => sourceLocator),
    entries.filter(({ name }) => !NOT_IN_UPDATE_PLAN.has(name)).map(({ name, version: packedVersion }) => `${name}@${packedVersion}`)));
  for (const { id, version: plannedVersion, integrity } of planned) {
    const packed = entries.find(({ name }) => name === id);
    if (packed && (packed.version !== plannedVersion || packed.integrity !== integrity)) problems.push(`${id} is not the packed artifact`);
  }
  return problems;
}
