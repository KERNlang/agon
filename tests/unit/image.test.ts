import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  isImagePath,
  mimeFromExt,
  resolveImagePath,
  buildImageAttachment,
  extractImagesFromInput,
  normalizeDroppedPath,
} from '../../packages/core/src/image.js';
import { buildCommand } from '../../packages/adapter-cli/src/generated/adapter-helpers.js';

// ── isImagePath ─────────────────────────────────────────────────────

describe('isImagePath', () => {
  it('returns true for image extensions', () => {
    expect(isImagePath('photo.png')).toBe(true);
    expect(isImagePath('photo.jpg')).toBe(true);
    expect(isImagePath('photo.jpeg')).toBe(true);
    expect(isImagePath('photo.gif')).toBe(true);
    expect(isImagePath('photo.webp')).toBe(true);
    expect(isImagePath('photo.svg')).toBe(true);
    expect(isImagePath('photo.bmp')).toBe(true);
  });

  it('returns false for non-image extensions', () => {
    expect(isImagePath('file.txt')).toBe(false);
    expect(isImagePath('file.ts')).toBe(false);
    expect(isImagePath('file.json')).toBe(false);
    expect(isImagePath('file.pdf')).toBe(false);
  });

  it('handles uppercase extensions', () => {
    expect(isImagePath('PHOTO.PNG')).toBe(true);
    expect(isImagePath('photo.JPG')).toBe(true);
  });
});

// ── mimeFromExt ─────────────────────────────────────────────────────

describe('mimeFromExt', () => {
  it('returns correct mime types', () => {
    expect(mimeFromExt('file.png')).toBe('image/png');
    expect(mimeFromExt('file.jpg')).toBe('image/jpeg');
    expect(mimeFromExt('file.jpeg')).toBe('image/jpeg');
    expect(mimeFromExt('file.gif')).toBe('image/gif');
    expect(mimeFromExt('file.webp')).toBe('image/webp');
    expect(mimeFromExt('file.svg')).toBe('image/svg+xml');
  });

  it('returns fallback for unknown extension', () => {
    expect(mimeFromExt('file.xyz')).toBe('application/octet-stream');
  });
});

// ── resolveImagePath ────────────────────────────────────────────────

describe('resolveImagePath', () => {
  const testDir = join(tmpdir(), `agon-image-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'test.png'), 'fake-png');
    writeFileSync(join(testDir, 'photo.jpg'), 'fake-jpg');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('resolves absolute paths', () => {
    const result = resolveImagePath(join(testDir, 'test.png'), '/');
    expect(result).toBe(join(testDir, 'test.png'));
  });

  it('resolves relative paths', () => {
    const result = resolveImagePath('test.png', testDir);
    expect(result).toBe(join(testDir, 'test.png'));
  });

  it('returns null for missing files', () => {
    const result = resolveImagePath('/nonexistent/file.png', '/');
    expect(result).toBeNull();
  });
});

// ── buildImageAttachment ────────────────────────────────────────────

describe('buildImageAttachment', () => {
  const testDir = join(tmpdir(), `agon-image-att-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'screenshot.png'), 'fake-png-data');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('builds attachment for existing file', () => {
    const att = buildImageAttachment(join(testDir, 'screenshot.png'), '/');
    expect(att).not.toBeNull();
    expect(att!.filename).toBe('screenshot.png');
    expect(att!.mimeType).toBe('image/png');
    expect(att!.path).toBe(join(testDir, 'screenshot.png'));
  });

  it('returns null for missing file', () => {
    const att = buildImageAttachment('/nonexistent.png', '/');
    expect(att).toBeNull();
  });
});

// ── extractImagesFromInput ──────────────────────────────────────────

describe('extractImagesFromInput', () => {
  const testDir = join(tmpdir(), `agon-image-extract-${Date.now()}`);

  // macOS default screenshots have spaces in their names — the case that broke
  // before. basename of this is "Screen Shot 2026.png".
  const spaced = () => join(testDir, 'Screen Shot 2026.png');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'screenshot.png'), 'fake');
    writeFileSync(join(testDir, 'photo.jpg'), 'fake');
    writeFileSync(spaced(), 'fake');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('detects absolute image paths in mixed text', () => {
    const input = `what is this ${join(testDir, 'screenshot.png')} about?`;
    const { text, images } = extractImagesFromInput(input, '/');
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('screenshot.png');
    expect(text).not.toContain(testDir);
  });

  it('returns empty images for text-only input', () => {
    const { text, images } = extractImagesFromInput('just some text', '/');
    expect(images).toHaveLength(0);
    expect(text).toBe('just some text');
  });

  it('handles /img command', () => {
    const { text, images } = extractImagesFromInput(`/img ${join(testDir, 'screenshot.png')}`, '/');
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('screenshot.png');
    expect(text).toBe('');
  });

  it('returns empty for /img with nonexistent file', () => {
    const { images } = extractImagesFromInput('/img /nonexistent/file.png', '/');
    expect(images).toHaveLength(0);
  });

  // ── drag-drop forms (the "clean version" gap) ─────────────────────

  it('detects a backslash-escaped-space path (Terminal/iTerm drag-drop)', () => {
    const dropped = spaced().replace(/ /g, '\\ ');
    const { text, images } = extractImagesFromInput(`whats wrong here ${dropped}`, '/');
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('Screen Shot 2026.png');
    expect(text).toBe('whats wrong here');
  });

  it('detects a single-quoted path with spaces', () => {
    const { images } = extractImagesFromInput(`'${spaced()}'`, '/');
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('Screen Shot 2026.png');
  });

  it('detects a double-quoted path with spaces', () => {
    const { images } = extractImagesFromInput(`"${spaced()}"`, '/');
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('Screen Shot 2026.png');
  });

  it('detects a file:// URI with %20-encoded spaces', () => {
    const uri = 'file://' + spaced().replace(/ /g, '%20');
    const { images } = extractImagesFromInput(uri, '/');
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('Screen Shot 2026.png');
  });

  it('attaches a bare unescaped-space path when it is the whole input (drag-drop fallback)', () => {
    const { text, images } = extractImagesFromInput(spaced(), '/');
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('Screen Shot 2026.png');
    expect(text).toBe('');
  });

  it('attaches an escaped-apostrophe path via the whole-input fallback', () => {
    const apos = join(testDir, "Bob's Shot.png");
    writeFileSync(apos, 'fake');
    const dropped = apos.replace(/'/g, "\\'").replace(/ /g, '\\ '); // terminal escapes both
    const { images } = extractImagesFromInput(dropped, '/');
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe("Bob's Shot.png");
  });

  it('does NOT attach a bare unescaped-space path embedded in prose (no false positive)', () => {
    const { images } = extractImagesFromInput(`look at ${spaced()} please`, '/');
    expect(images).toHaveLength(0);
  });

  it('does NOT attach ordinary prose that happens to end in a word (fallback is existsSync-gated)', () => {
    const { text, images } = extractImagesFromInput('can you help me with this', '/');
    expect(images).toHaveLength(0);
    expect(text).toBe('can you help me with this');
  });

  it('detects multiple images of mixed form in one message', () => {
    const input = `compare ${join(testDir, 'screenshot.png')} and "${spaced()}" please`;
    const { text, images } = extractImagesFromInput(input, '/');
    expect(images).toHaveLength(2);
    expect(images.map((i) => i.filename).sort()).toEqual(
      ['Screen Shot 2026.png', 'screenshot.png'],
    );
    expect(text).toBe('compare and please');
  });
});

// ── normalizeDroppedPath ────────────────────────────────────────────

describe('normalizeDroppedPath', () => {
  it('strips matching single quotes', () => {
    expect(normalizeDroppedPath("'/a/b c.png'")).toBe('/a/b c.png');
  });

  it('strips matching double quotes', () => {
    expect(normalizeDroppedPath('"/a/b c.png"')).toBe('/a/b c.png');
  });

  it('unescapes backslash-escaped spaces', () => {
    expect(normalizeDroppedPath('/a/b\\ c.png')).toBe('/a/b c.png');
  });

  it('decodes a file:// URI', () => {
    expect(normalizeDroppedPath('file:///a/My%20Shot.png')).toBe('/a/My Shot.png');
  });

  it('leaves a plain path untouched', () => {
    expect(normalizeDroppedPath('/a/b/shot.png')).toBe('/a/b/shot.png');
  });
});

// ── buildCommand with images ────────────────────────────────────────

describe('buildCommand with images', () => {

  const visionEngine = {
    schemaVersion: 2 as const,
    id: 'claude',
    displayName: 'Claude',
    binary: 'claude',
    searchPaths: [],
    versionCmd: ['--version'],
    isLocal: false,
    tier: 'builtin' as const,
    timeout: 360,
    exec: { args: ['--print', '{prompt}'] },
    capabilities: ['vision'],
    imageFlag: '--image',
  };

  const textEngine = {
    schemaVersion: 2 as const,
    id: 'codex',
    displayName: 'Codex',
    binary: 'codex',
    searchPaths: [],
    versionCmd: ['--version'],
    isLocal: false,
    tier: 'builtin' as const,
    timeout: 120,
    exec: { args: ['--print', '{prompt}'] },
  };

  const testImages = [
    { path: '/tmp/test.png', filename: 'test.png', mimeType: 'image/png' },
  ];

  it('adds --image flag for vision engine', () => {
    const { args } = buildCommand(visionEngine, 'exec', 'describe this', '/', 60, '/usr/bin/claude', testImages);
    expect(args).toContain('--image');
    expect(args).toContain('/tmp/test.png');
    // --image should appear before the prompt
    const imageIdx = args.indexOf('--image');
    const promptIdx = args.indexOf('describe this');
    expect(imageIdx).toBeLessThan(promptIdx);
  });

  it('prepends text fallback for non-vision engine', () => {
    const { args } = buildCommand(textEngine, 'exec', 'describe this', '/', 60, '/usr/bin/codex', testImages);
    expect(args).not.toContain('--image');
    // The prompt should contain the full image path
    const promptArg = args.find((a: string) => a.includes('[Image:'));
    expect(promptArg).toBeDefined();
    expect(promptArg).toContain('/tmp/test.png');
  });

  it('works without images', () => {
    const { args } = buildCommand(visionEngine, 'exec', 'hello', '/', 60, '/usr/bin/claude');
    expect(args).not.toContain('--image');
    expect(args).toContain('hello');
  });
});
