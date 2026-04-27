import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { clearFileTracker, getFileDiff, listFiles, recordToolCall } from '../../packages/cli/src/generated/signals/file-tracker.js';

const tempDirs: string[] = [];

afterEach(() => {
  clearFileTracker();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agon-file-tracker-'));
  tempDirs.push(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('file tracker diff previews', () => {
  it('shows a pseudo-diff for untracked created files', () => {
    const repo = makeGitRepo();
    const file = join(repo, 'created.ts');
    writeFileSync(file, 'const x = 1;\nexport { x };\n');

    const diff = getFileDiff(file, 4);

    expect(diff).toContain('@@ new file @@');
    expect(diff).toContain('+const x = 1;');
    expect(diff).toContain('+export { x };');
  });

  it('records apply_patch file paths for the Ctrl+B file rail', () => {
    clearFileTracker();

    recordToolCall('apply_patch', [
      '*** Begin Patch',
      '*** Update File: packages/cli/src/kern/surfaces/app.kern',
      '@@',
      '-old',
      '+new',
      '*** Add File: tests/unit/new-visible-file.test.ts',
      '+test',
      '*** End Patch',
    ].join('\n'), 'done');

    const files = listFiles().map((file) => file.relPath);

    expect(files).toContain('packages/cli/src/kern/surfaces/app.kern');
    expect(files).toContain('tests/unit/new-visible-file.test.ts');
  });

  it('records MCP AgonEdit and AgonWrite file paths for the Ctrl+B file rail', () => {
    clearFileTracker();

    recordToolCall('AgonEdit', JSON.stringify({
      file_path: 'packages/cli/src/kern/cesar/session.kern',
      old_string: 'old',
      new_string: 'new',
    }), 'done');
    recordToolCall('AgonWrite', JSON.stringify({
      file_path: 'tests/unit/generated-visible.test.ts',
      content: 'test',
    }), 'done');

    const files = listFiles();
    const byPath = new Map(files.map((file) => [file.relPath, file.status]));

    expect(byPath.get('packages/cli/src/kern/cesar/session.kern')).toBe('edited');
    expect(byPath.get('tests/unit/generated-visible.test.ts')).toBe('created');
  });
});
