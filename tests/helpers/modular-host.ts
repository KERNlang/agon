import type { CanonicalModLock } from '../../packages/mod-kernel/src/lock.js';

const hash = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

export function hostLock(graphCharacter = 'a'): CanonicalModLock {
  return Object.freeze({
    schemaVersion: 1,
    kernelVersion: '1.0.0',
    apiVersion: '1.0.0',
    desiredStateHash: hash('d'),
    graphHash: hash(graphCharacter),
    packages: Object.freeze([]),
  });
}
