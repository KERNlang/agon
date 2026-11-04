import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileChecksFor } from '../../packages/support-worktree/src/index.js';

const GO_CHECK = "go test -count=1 -run '^$' ./...";
const dirs: string[] = [];

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'agon-check-scope-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true }); });

describe('review: compile checks scoped to the nearest module', () => {
  it('review: a nested go module gets a cd-prefixed check keyed by file', () => {
    const dir = repo({ 'services/api/go.mod': 'module api', 'services/api/h/a.go': '' });
    expect(compileChecksFor(['services/api/h/a.go'], dir)).toEqual({ 'services/api/h/a.go': `cd 'services/api' && ${GO_CHECK}` });
  });

  it('review: two nested modules give two distinct checks; files in one module share one command', () => {
    const dir = repo({ 'a/go.mod': '', 'b/go.mod': '', 'a/x.go': '', 'a/y.go': '', 'b/z.go': '' });
    const checks = compileChecksFor(['a/x.go', 'a/y.go', 'b/z.go'], dir);
    expect(checks).toEqual({ 'a/x.go': `cd 'a' && ${GO_CHECK}`, 'a/y.go': `cd 'a' && ${GO_CHECK}`, 'b/z.go': `cd 'b' && ${GO_CHECK}` });
    expect(new Set(Object.values(checks)).size).toBe(2);
  });

  it('review: a root module and marker-less files keep the profile-keyed check', () => {
    expect(compileChecksFor(['pkg/a.go', 'b.rs'], repo({ 'go.mod': '', 'pkg/a.go': '', 'b.rs': '' })))
      .toEqual({ go: GO_CHECK, rs: 'cargo test --no-run' });
  });

  it('review: nested maven, cargo and dotnet modules resolve their own manifests', () => {
    const dir = repo({ 'sub/pom.xml': '', 'sub/src/A.java': '', 'crates/x/Cargo.toml': '', 'crates/x/src/l.rs': '', 'cs/App.csproj': '', 'cs/P.cs': '' });
    expect(compileChecksFor(['sub/src/A.java', 'crates/x/src/l.rs', 'cs/P.cs'], dir)).toEqual({
      'sub/src/A.java': "cd 'sub' && mvn -q test-compile",
      'crates/x/src/l.rs': "cd 'crates/x' && cargo test --no-run",
      'cs/P.cs': "cd 'cs' && dotnet build",
    });
  });

  it('review: python stays a per-file check with no cd', () => {
    expect(compileChecksFor(['sub/m.py'], repo({ 'sub/pyproject.toml': '', 'sub/m.py': '' }))).toEqual({ py: 'python3 -m py_compile {file}' });
  });
});
