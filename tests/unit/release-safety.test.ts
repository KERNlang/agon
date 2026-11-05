import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    ['username that only starts like a placeholder', '/home/alice.smith/x', 'x.js'],
    ['dashed username that only starts like a placeholder', '/Users/dev-jane/x', 'x.js'],
    ['dotted username after a placeholder word', '/home/test.x/y', 'x.js'],
    ['WSL mount of a windows home', '/mnt/c/Users/janedoe/x', 'x.js'],
    ['immutable-distro home', '/var/home/janedoe/x', 'x.js'],
    ['mac volume home', '/Volumes/Data/Users/janedoe/x', 'x.js'],
    ['home path with no trailing separator', 'cwd=/home/janedoe', 'x.js'],
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
    ['prefixed web route, not a home directory', '/api/users/foo/ and /mnt/data/users/foo/ and /v1/home/foo'],
    ['placeholder with no trailing separator', 'cwd=/home/you and /Users/runner'],
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

describe('release version stamp', () => {
  const LITERAL_FILES: Array<[string, string]> = [
    ['packages/cli/src/index.ts', "name: 'agon', version: '0.0.1'"],
    ['packages/cli/src/blocks/engine.tsx', "resolvePackageVersion('@kernlang/agon', '0.0.1')"],
    ['packages/cli/src/commands/setup.ts', "const VERSION = '0.0.1'"],
    ['packages/mod-kernel/src/runtime-version.ts', "AGON_RUNTIME_VERSION = '0.0.1'"],
    ['packages/mod-api/src/version.ts', "AGON_MOD_API_VERSION = '0.0.1'"],
    ['scripts/spec/generate-modular-first-party-packages.mjs', "const RELEASE_VERSION = '0.0.1'"],
    ['scripts/spec/generate-modular-support-package-metadata.mjs', "const version = '0.0.1'"],
  ];

  function fixtureRepo(lastLiteral: string) {
    const root = scratch();
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    };
    mkdirSync(join(root, 'scripts/release'), { recursive: true });
    for (const script of ['set-version.mjs', 'release-plan.mjs']) {
      copyFileSync(join(import.meta.dirname, '../../scripts/release', script), join(root, 'scripts/release', script));
    }
    write('package.json', JSON.stringify({ workspaces: ['packages/a'] }));
    write('packages/a/package.json', JSON.stringify({ name: '@kernlang/agon-a', version: '0.0.1' }));
    write('packages/a/agon.mod.json', JSON.stringify({ version: '0.0.1' }));
    LITERAL_FILES.forEach(([path, literal], index) => write(path, index === LITERAL_FILES.length - 1 ? lastLiteral : literal));
    const snapshot = () => ['packages/a/package.json', 'packages/a/agon.mod.json', ...LITERAL_FILES.map(([path]) => path)]
      .map((path) => readFileSync(join(root, path), 'utf8'));
    const stamp = () => spawnSync(process.execPath, [join(root, 'scripts/release/set-version.mjs'), '9.9.9'], { encoding: 'utf8' });
    return { snapshot, stamp };
  }

  it('a version literal missing late in the list leaves zero files written, not a half-stamped tree', () => {
    const broken = fixtureRepo('the literal was renamed');
    const before = broken.snapshot();
    const failed = broken.stamp();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/version literal not found/);
    expect(broken.snapshot()).toEqual(before);

    const valid = fixtureRepo(LITERAL_FILES.at(-1)![1]);
    expect(valid.stamp().status).toBe(0);
    expect(valid.snapshot().every((content) => content.includes('9.9.9'))).toBe(true);
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

describe('release GitHub Release job', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const job = workflow.match(/^ {2}github-release:\n((?:(?: {3,}.*)?\n)+)/m)?.[1] ?? '';
  const script = (job.match(/run: \|\n((?: {10}.*\n)+)/)?.[1] ?? '').replace(/^ {10}/gm, '');

  function runJob(view: 'exists' | 'missing', create: 'ok' | 'fails' = 'ok') {
    const dir = scratch();
    const log = join(dir, 'gh.log');
    writeFileSync(join(dir, 'gh'), `#!/bin/sh
echo "$*" >> "${log}"
if [ "$2" = view ]; then [ "${view}" = exists ]; exit $?; fi
[ "${create}" = ok ]
`);
    chmodSync(join(dir, 'gh'), 0o755);
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: { ...process.env, PATH: `${dir}:${originalPath}`, GITHUB_REF_NAME: 'v9.9.9' },
    });
    const creates = existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').filter((call) => call.startsWith('release create'))
      : [];
    return { status: result.status, creates };
  }

  it('a publish that reaches npm leaves the Releases panel current, and never on a failed publish or over an existing Release', () => {
    expect(job).toMatch(/^ {4}needs: publish$/m);
    expect(job).toMatch(/^ {6}contents: write$/m);
    expect(job).not.toMatch(/uses:|continue-on-error/);

    expect(runJob('exists')).toEqual({ status: 0, creates: [] });

    const created = runJob('missing');
    expect(created.status).toBe(0);
    expect(created.creates).toEqual(['release create v9.9.9 --verify-tag --title v9.9.9 --generate-notes']);

    expect(runJob('missing', 'fails').status).not.toBe(0);
  });
});
