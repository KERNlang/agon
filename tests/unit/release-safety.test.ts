import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error untyped release script
import { checkPackedTree } from '../../scripts/release/leak-check.mjs';
// @ts-expect-error untyped release script
import { publishIfNew } from '../../scripts/release/publish-if-new.mjs';

const scratchDirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-safety-'));
  scratchDirs.push(dir);
  return dir;
};
const originalPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.FAKE_NPM_VIEW;
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scanOne = (path: string, bytes: string | Buffer): string[] => {
  const root = scratch();
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
  return checkPackedTree(root, [path]);
};

const KEY_BODY = 'Ab3dEf6hIj9lMn2pQr5tUv8xYz1cFg4kNo7sWa0e';

describe('release leak check', () => {
  it('a packed credential or personal path in any file type fails the pack, while placeholders and web routes do not', () => {
    const leaks: Array<[string, string | Buffer, string]> = [
    ['OpenRouter key', `key="${'sk-or-'}v1-${KEY_BODY}"`, 'data/seed.wasm'],
    ['OpenAI project key with dashes and underscores', `${'sk-'}proj-Ab3_dEf-${KEY_BODY}`, 'assets/config.conf'],
    ['bare OpenAI key', `${'sk-'}${KEY_BODY}`, 'LICENSE'],
    ['Anthropic key', `${'sk-'}ant-api03-${KEY_BODY}`, 'x.js'],
    ['npm token', `${'npm_'}${KEY_BODY.slice(0, 36)}`, 'x.js'],
    ['GitHub token', `${'ghp_'}${KEY_BODY}`, 'x.js'],
    ['GitHub fine-grained token', `${'github_'}pat_${KEY_BODY}_${KEY_BODY}`, 'x.js'],
    ['AWS key', `${'AKIA'}ABCDEFGHIJKLMNOP`, 'x.js'],
    ['private key', `-----BEGIN RSA ${'PRIVATE KEY'}-----`, 'x.js'],
    ['mac path with a mixed-case username', 'at /Users/JaneDoe/work/x.js', 'x.js'],
    ['linux path', 'file:///home/janedoe/work/x.js', 'x.js'],
    ['windows path', 'C:\\Users\\JaneDoe\\work\\x.js', 'x.js'],
    ['JSON-escaped windows path', '"D:\\\\Users\\\\janedoe\\\\x.js"', 'x.json'],
    ['windows path with forward slashes', 'c:/users/JaneDoe/work', 'notes.custom'],
    ['source map embedding the sources', '{"sourcesContent":["const key = 1"]}', 'dist/x.js.map'],
    ['unreadable source map', 'not json', 'dist/x.js.map'],
    ['dotenv file', 'A=1', '.env.production'],
    ['TypeScript source', 'export {}', 'src/x.ts'],
    ['test file', 'export {}', 'dist/x.test.js'],
    ['key file', 'x', 'certs/x.pem'],
    ['npm credentials file', 'x', '.npmrc'],
    ['secret embedded in a binary', Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(`${'ghp_'}${KEY_BODY}`)]), 'native/addon.node'],
    ];
    for (const [label, bytes, path] of leaks) expect.soft(scanOne(path, bytes), label).toHaveLength(1);

    const harmless = [
    ['documented placeholder', '/Users/you/project and /home/runner/work and C:\\Users\\you\\x'],
    ['web route, not a home directory', 'https://example.com/users/janedoe/ and /api/Users/janedoe/'],
    ['short sk- identifier', 'sk-abc and task-Ab3dEf6hIj9lMn2pQr5tUv8xYz1cFg4kNo7sWa0e'],
    ];
    for (const [label, text] of harmless) expect.soft(scanOne('dist/x.js', text), label).toEqual([]);
  });

  it('a nested archive could smuggle unscanned files into a tarball, so it fails the pack even when renamed', () => {
    const ustar = Buffer.alloc(512);
    ustar.write('ustar', 257, 'latin1');
    const archives: Array<[string, string, string | Buffer]> = [
    ['tgz', 'vendor/old-release.tgz', 'not checked by content'],
    ['zip', 'vendor/bundle.ZIP', 'not checked by content'],
    ['gzip renamed to hide it', 'assets/data.bin', Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00])],
    ['zip renamed to hide it', 'assets/data.dat', Buffer.from('PK\x03\x04rest', 'latin1')],
    ['tar renamed to hide it', 'assets/data.db', ustar],
    ];
    for (const [label, path, bytes] of archives) expect.soft(scanOne(path, bytes).join(), label).toMatch(/nested archive/);
    expect.soft(scanOne('README.md', 'PK is a zip magic; see release.tgz and a.tar.gz')).toEqual([]);
  });
});

describe('release publish decision', () => {
  const entry = (bytes: Buffer) => ({
    name: '@kernlang/agon-fixture',
    version: '1.0.0',
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  });

  function fakeNpm() {
    const dir = scratch();
    const log = join(dir, 'npm.log');
    writeFileSync(join(dir, 'npm'), `#!/bin/sh
echo "$*" >> "${log}"
if [ "$1" = view ]; then
  case "$FAKE_NPM_VIEW" in
    e404) echo 'npm error code E404' >&2; exit 1 ;;
    down) echo 'npm error code ECONNRESET' >&2; exit 1 ;;
    *) echo "\\"$FAKE_NPM_VIEW\\"" ;;
  esac
fi
`);
    chmodSync(join(dir, 'npm'), 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
    const tarball = join(dir, 'fixture.tgz');
    const bytes = Buffer.from('approved tarball bytes');
    writeFileSync(tarball, bytes);
    return { tarball, bytes, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []) };
  }
  const published = (calls: string[]) => calls.filter((call) => call.startsWith('publish'));

  it('a tarball changed after the gate approved it, or a conflicting or unknowable registry state, never reaches npm publish', () => {
    const { tarball, bytes, calls } = fakeNpm();
    const approved = entry(bytes);

    process.env.FAKE_NPM_VIEW = 'e404';
    expect(() => publishIfNew({ ...approved, integrity: entry(Buffer.from('other')).integrity }, tarball)).toThrow(/approved/);
    expect(calls()).toEqual([]);

    process.env.FAKE_NPM_VIEW = 'down';
    expect(() => publishIfNew(approved, tarball)).toThrow(/cannot query npm/);
    expect(published(calls())).toEqual([]);

    process.env.FAKE_NPM_VIEW = entry(Buffer.from('different')).integrity;
    expect(() => publishIfNew(approved, tarball)).toThrow(/different bytes/);
    expect(published(calls())).toEqual([]);

    process.env.FAKE_NPM_VIEW = approved.integrity;
    expect(publishIfNew(approved, tarball)).toBe('skipped');
    expect(published(calls())).toEqual([]);

    process.env.FAKE_NPM_VIEW = 'e404';
    expect(publishIfNew(approved, tarball, { provenance: true })).toBe('published');
    expect(published(calls())).toEqual([`publish ${tarball} --access public --provenance`]);
  });
});
