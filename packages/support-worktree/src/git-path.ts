/** Decode Git's C-quoted path bytes, including octal UTF-8 sequences. */
export function decodeGitPath(path: string): string {
  if (!path.startsWith('"')) return path;
  if (!path.endsWith('"')) throw new Error('Unterminated quoted Git path');
  const bytes: Buffer[] = [];
  const escapes: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '"': '"', '\\': '\\' };
  for (let index = 1; index < path.length - 1; index++) {
    if (path[index] !== '\\') {
      if (path[index] === '"') throw new Error('Unescaped quote in Git path');
      const character = String.fromCodePoint(path.codePointAt(index)!);
      bytes.push(Buffer.from(character));
      index += character.length - 1;
      continue;
    }
    const octal = path.slice(index + 1, index + 4);
    if (/^[0-3][0-7]{2}$/.test(octal)) {
      bytes.push(Buffer.from([Number.parseInt(octal, 8)]));
      index += 3;
    } else {
      if (index + 1 >= path.length - 1) throw new Error('Unterminated quoted Git path escape');
      const escaped = escapes[path[++index]];
      if (escaped === undefined) throw new Error('Invalid quoted Git path escape');
      bytes.push(Buffer.from(escaped));
    }
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(bytes));
}
