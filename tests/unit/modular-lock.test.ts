import { describe, expect, it } from 'vitest';
import { canonicalJson, createCanonicalLock, resolveCandidates, sha256Canonical } from '../../packages/mod-kernel/src/index.js';
import { candidate } from '../helpers/modular-agon.js';

const contentHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const manifestHash = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const trustedCandidate = (id: string) => candidate(id, '1.0.0', 'registry', { contentHash, manifestHash });

describe('Modular Agon canonical lock', () => {
  it('produces byte-identical locks for permuted normalized input', () => {
    const candidates = [trustedCandidate('example.beta'), trustedCandidate('example.alpha')];
    const options = { platform: 'linux-x64' as const, kernelVersion: '1.0.0', apiVersion: '1.0.0', nodeVersion: '22.22.0' };
    const trustRecordIds = { 'example.alpha': 'trust:alpha', 'example.beta': 'trust:beta' };
    const first = createCanonicalLock(resolveCandidates(candidates, ['example.beta', 'example.alpha'], options), {
      kernelVersion: '1.0.0', apiVersion: '1.0.0', platform: 'linux-x64', desiredIds: ['example.beta', 'example.alpha'], trustRecordIds,
    });
    const second = createCanonicalLock(resolveCandidates([...candidates].reverse(), ['example.alpha', 'example.beta'], options), {
      kernelVersion: '1.0.0', apiVersion: '1.0.0', platform: 'linux-x64', desiredIds: ['example.alpha', 'example.beta'], trustRecordIds,
    });
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.graphHash).toBe(second.graphHash);
    expect(first.packages.map(({ id }) => id)).toEqual(['example.alpha', 'example.beta']);
  });

  it('sorts object keys, normalizes negative zero, and rejects non-JSON values', () => {
    expect(canonicalJson({ z: -0, a: [2, 1] })).toBe('{"a":[2,1],"z":0}');
    expect(sha256Canonical({ b: 2, a: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => canonicalJson({ missing: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(String.fromCharCode(0xd800))).toThrow(/surrogate/i);
    expect(() => canonicalJson(String.fromCharCode(0xdc00))).toThrow(/surrogate/i);
    expect(() => canonicalJson({ [String.fromCharCode(0xd800)]: true })).toThrow(/surrogate/i);
  });

  it('refuses to fabricate lock integrity or trust evidence', () => {
    const runtime = { platform: 'linux-x64' as const, kernelVersion: '1.0.0', apiVersion: '1.0.0', nodeVersion: '22.22.0' };
    const unverified = resolveCandidates([candidate('example.mod')], ['example.mod'], runtime);
    expect(() => createCanonicalLock(unverified, {
      kernelVersion: '1.0.0', apiVersion: '1.0.0', platform: 'linux-x64', desiredIds: ['example.mod'],
      trustRecordIds: { 'example.mod': 'trust:mod' },
    })).toThrow(/content hash/i);
    const verified = resolveCandidates([trustedCandidate('example.mod')], ['example.mod'], runtime);
    expect(() => createCanonicalLock(verified, {
      kernelVersion: '1.0.0', apiVersion: '1.0.0', platform: 'linux-x64', desiredIds: [],
      trustRecordIds: { 'example.mod': 'trust:mod' },
    })).toThrow(/desired/i);
    expect(() => createCanonicalLock(verified, {
      kernelVersion: '1.0.0', apiVersion: '1.0.0', platform: 'linux-x64', desiredIds: ['example.mod'],
    })).toThrow(/trust/i);
    const trustRecordIds = { 'example.mod': 'trust:mod' };
    expect(() => createCanonicalLock(verified, {
      kernelVersion: '2.0.0', apiVersion: '1.0.0', platform: 'linux-x64', desiredIds: ['example.mod'], trustRecordIds,
    })).toThrow(/resolver context/i);
    expect(() => createCanonicalLock(verified, {
      kernelVersion: '1.0.0', apiVersion: '2.0.0', platform: 'linux-x64', desiredIds: ['example.mod'], trustRecordIds,
    })).toThrow(/resolver context/i);
    expect(() => createCanonicalLock(verified, {
      kernelVersion: '1.0.0', apiVersion: '1.0.0', platform: 'darwin-arm64', desiredIds: ['example.mod'], trustRecordIds,
    })).toThrow(/resolver context/i);
  });
});
