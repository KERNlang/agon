import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { isSecretPath, redactSecretsPreservingLines } from '@kernlang/agon-support-verification';
import type { Finding } from './repair.js';

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

export type SourceReader = (file: string) => string | null | undefined;

function workingTreeReader(cwd: string): SourceReader {
  const cache = new Map<string, string | null | undefined>();
  let root: string | undefined;
  return (file) => {
    if (cache.has(file)) return cache.get(file);
    const read = (): string | null | undefined => {
      if (!file || isAbsolute(file) || isSecretPath(file) || !inside(resolve(cwd), resolve(cwd, file))) return undefined;
      let path: string;
      try {
        root ??= realpathSync(cwd);
        path = realpathSync(resolve(cwd, file));
      } catch {
        return null;
      }
      if (!inside(root, path) || isSecretPath(relative(root, path))) return undefined;
      try {
        if (statSync(path).size > MAX_SOURCE_BYTES) return undefined;
        return normalize(redactSecretsPreservingLines(readFileSync(path, 'utf8')));
      } catch {
        return null;
      }
    };
    const source = read();
    cache.set(file, source);
    return source;
  };
}

export function diffPostImage(diff: string): Map<string, string> {
  const files = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { current = undefined; continue; }
    const target = /^\+\+\+ (?:"?b\/)?(.+?)"?$/.exec(line);
    if (target) {
      current = target[1] === '/dev/null' ? undefined : [];
      if (current) files.set(target[1], current);
      continue;
    }
    if (current && (line.startsWith('+') || line.startsWith(' '))) current.push(line.slice(1));
  }
  return new Map([...files].map(([file, lines]) => [file, normalize(lines.join('\n'))]));
}

function diffReader(diff: string): SourceReader {
  const images = diffPostImage(diff);
  return (file) => (isSecretPath(file) ? undefined : images.get(file) ?? null);
}

export function existingCodeMatch(file: string, snippet: string, cwd: string): boolean | undefined {
  return matchWith(workingTreeReader(cwd), file, snippet);
}

function matchWith(reader: SourceReader, file: string, snippet: string): boolean | undefined {
  const quote = normalize(snippet);
  if (!quote) return undefined;
  const source = reader(file);
  if (source === undefined) return undefined;
  return source !== null && source.includes(quote);
}

export function annotateExistingCode(findings: readonly Finding[], reader: SourceReader): Finding[] {
  return findings.map((finding) => {
    if (!finding.existingCode) return finding;
    const match = matchWith(reader, finding.file, finding.existingCode);
    return match === undefined ? finding : { ...finding, existingCodeMatch: match };
  });
}

export function existingCodeReader(source: { readonly cwd: string } | { readonly diff: string }): SourceReader {
  return 'cwd' in source ? workingTreeReader(source.cwd) : diffReader(source.diff);
}
