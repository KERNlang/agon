import { decodeGitPath } from './git-path.js';

/** Physical owner of unified-diff parsing and inversion. */
export interface PatchHunk {
  header: string;
  lines: string[];
  additions: number;
  deletions: number;
}

export interface PatchFile {
  path: string;
  hunks: PatchHunk[];
  additions: number;
  deletions: number;
}

function diffTargetPath(line: string): string {
  const body = line.slice('diff --git '.length);
  // Unquoted paths can themselves contain " b/". Mode-only changes have no
  // later ---/+++ headers, so resolve their identical pair without guessing.
  const samePath = body.slice(2, 2 + (body.length - 5) / 2);
  if (body === `a/${samePath} b/${samePath}`) return samePath;
  const match = body.match(/^(?:"(?:\\.|[^"])*"|a\/.*?) ("(?:\\.|[^"])*"|b\/.*)$/);
  return match ? decodeGitPath(match[1]).replace(/^[ab]\//, '') : 'unknown';
}

/**
 * Parse a unified diff into structured file-level and hunk-level data.
 */
export function parsePatch(content: string): PatchFile[] {
  const files: PatchFile[] = [];
  const lines = content.split('\n');
  let currentFile: PatchFile | null = null;
  let currentHunk: PatchHunk | null = null;

  for (const line of lines) {
    // File header: diff --git a/path b/path
    if (line.startsWith('diff --git')) {
      if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
      if (currentFile) files.push(currentFile);
      const path = diffTargetPath(line);
      currentFile = { path, hunks: [], additions: 0, deletions: 0 };
      currentHunk = null;
      continue;
    }

    // Hunk header: @@ -start,count +start,count @@
    if (line.startsWith('@@')) {
      if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
      currentHunk = { header: line, lines: [], additions: 0, deletions: 0 };
      continue;
    }

    if (!currentHunk && currentFile) {
      if (line.startsWith('rename to ') || line.startsWith('copy to ')) {
        currentFile.path = decodeGitPath(line.slice(line.startsWith('rename to ') ? 10 : 8));
      } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        const path = decodeGitPath(line.slice(4).split('\t', 1)[0]);
        if (path !== '/dev/null') currentFile.path = path.replace(/^[ab]\//, '');
      }
    }
    // Skip metadata lines
    if (!currentHunk && (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file'))) {
      continue;
    }

    // Content lines
    if (currentHunk) {
      currentHunk.lines.push(line);
      if (line.startsWith('+')) {
        currentHunk.additions++;
        if (currentFile) currentFile.additions++;
      } else if (line.startsWith('-')) {
        currentHunk.deletions++;
        if (currentFile) currentFile.deletions++;
      }
    }
  }

  if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);

  return files;
}

/**
 * Human-readable summary of a parsed patch.
 */
export function patchSummary(files: PatchFile[]): string {
  if (files.length === 0) return '(empty patch)';
  const totalAdd = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDel = files.reduce((sum, f) => sum + f.deletions, 0);
  const fileNames = files.map((f) => {
    const displayPath = /\p{Cc}/u.test(f.path)
      ? JSON.stringify(f.path).replace(/\p{Cc}/gu, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
      : f.path;
    const parts: string[] = [displayPath];
    if (f.additions || f.deletions) parts.push(`+${f.additions}/-${f.deletions}`);
    return parts.join(' ');
  });
  return `${files.length} file${files.length === 1 ? '' : 's'} changed (+${totalAdd}, -${totalDel})\n${fileNames.join('\n')}`;
}

/**
 * Swap +/- lines to produce an inverse patch for undo.
 * Incomplete entries need workspace bytes. Use applyPatchWithUndo for them.
 */
export function invertPatch(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inHunk = false;
  let fileHeader = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      fileHeader = result.length;
      result.push(line);
    } else if (!inHunk && fileHeader >= 0 && line.startsWith('copy from ')) {
      throw new Error('Copy inversion requires workspace context; use applyPatchWithUndo');
    } else if (!inHunk && line === 'GIT binary patch') {
      // Git stores forward and reverse literal/delta payloads, each terminated
      // by a blank line. Swap whole payloads without interpreting base85 bytes.
      const firstStart = index + 1;
      const firstEnd = lines.indexOf('', firstStart);
      const secondStart = firstEnd + 1;
      const secondEnd = lines.indexOf('', secondStart);
      const isPayload = (value: string | undefined) => /^(literal|delta) [0-9]+$/.test(value ?? '');
      if (firstEnd >= firstStart && secondEnd >= secondStart
        && isPayload(lines[firstStart]) && isPayload(lines[secondStart])) {
        // Append without spreading unbounded payloads into function arguments.
        result.push(line);
        for (let payload = secondStart; payload < secondEnd; payload++) result.push(lines[payload]);
        result.push('');
        for (let payload = firstStart; payload < firstEnd; payload++) result.push(lines[payload]);
        result.push('');
        index = secondEnd;
      } else {
        throw new Error('Binary inversion requires a reverse payload or workspace context; use applyPatchWithUndo');
      }
    } else if (line.startsWith('@@')) {
      const match = line.match(/^@@ -([0-9]+(?:,[0-9]+)?) \+([0-9]+(?:,[0-9]+)?) @@(.*)$/);
      inHunk = true;
      result.push(match ? `@@ -${match[2]} +${match[1]} @@${match[3]}` : line);
    } else if (inHunk && line.startsWith('+')) {
      result.push('-' + line.slice(1));
    } else if (inHunk && line.startsWith('-')) {
      result.push('+' + line.slice(1));
    } else if (!inHunk && line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ')) {
      result.push('--- ' + lines[index + 1].slice(4), '+++ ' + line.slice(4));
      index++;
    } else if (!inHunk && line.startsWith('new file mode ')) {
      result.push(line.replace('new file mode ', 'deleted file mode '));
    } else if (!inHunk && line.startsWith('deleted file mode ')) {
      result.push(line.replace('deleted file mode ', 'new file mode '));
    } else if (!inHunk && line.startsWith('index ')) {
      result.push(line.replace(/^(index )([0-9a-f]+)\.\.([0-9a-f]+)/, '$1$3..$2'));
    } else if (!inHunk && line.startsWith('old mode ') && lines[index + 1]?.startsWith('new mode ')) {
      result.push('old mode ' + lines[index + 1].slice(9), 'new mode ' + line.slice(9));
      index++;
    } else if (!inHunk && line.startsWith('rename from ') && lines[index + 1]?.startsWith('rename to ')) {
      const from = line.slice(12);
      const to = lines[++index].slice(10);
      result.push('rename from ' + to, 'rename to ' + from);
      // Rename metadata is unambiguous even when names contain spaces. Keep
      // Git's C-quoted bytes intact; do not decode and re-encode octal escapes.
      const prefixed = (path: string, prefix: string) => path.startsWith('"')
        ? `"${prefix}/${path.slice(1)}` : `${prefix}/${path}`;
      if (fileHeader >= 0) result[fileHeader] = `diff --git ${prefixed(to, 'a')} ${prefixed(from, 'b')}`;
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
}
