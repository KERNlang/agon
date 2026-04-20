# Smart Auto Permission Mode

## Problem

Agon's permission system has two extremes: `'ask'` (prompt on every mutating operation) and `'auto'` (allow everything). There's no middle ground. The "Always" button on the Y/N/Always prompt adds commands to `settings.json` permanently, which is too coarse — users don't want `git add` whitelisted forever, they want it trusted *for this session*.

Claude Code and Codex feel fluid because they trust their own orchestrator loops. Agon should too.

## Solution

Add a `'smart'` permission mode — the new default — that auto-approves operations the system can validate as safe, and only prompts for genuinely surprising actions.

### Smart Auto Rules (deny > smart > ask > allow)

| Scenario | Decision | Rationale |
|----------|----------|-----------|
| Dangerous command (`rm -rf`, `sudo`, fork bomb) | **deny** | Never allowed |
| Explicit `deny` in settings.json toolPermissions | **deny** | User override |
| Explicit `allow` in settings.json toolPermissions | **allow** | User override |
| Read-only command (`ls`, `git status`, `npm test`) | **allow** | Already safe |
| Command in `allowedCommands` (settings.json) | **allow** | Permanent whitelist |
| Command in **session allowlist** | **allow** | Approved once this session |
| Edit/Write to file already **git-dirty** in current branch | **allow** | Human or Cesar already touched it |
| Bash/Edit/Write from **orchestrator tool loop** (Cesar, forge, agent) | **allow** | System-generated, not user freeform |
| Everything else | **ask** | Surprising action — prompt user |

### New Concepts

1. **Session allowlist** — `string[]` held in memory (on HandlerContext), not persisted. When user approves a command in smart mode via Y, the base command is added to the session allowlist. Evaporates when agon exits. Lower commitment than "Always" (which writes to settings.json).

2. **Git-dirty auto-approve** — Before prompting for Edit/Write, check `git diff --name-only` + `git diff --cached --name-only`. If the target file appears in the diff, auto-approve. Only prompt for files nobody has touched yet.

3. **Orchestrator context flag** — A `source: 'user' | 'orchestrator'` field on ToolContext. When Cesar's tool loop or forge/agent dispatches a tool call, source is `'orchestrator'`. Smart mode auto-approves non-dangerous orchestrator calls. Direct user-typed commands stay `source: 'user'` and follow normal rules.

## Files Changed

### Core (packages/core)

| File | Change |
|------|--------|
| `kern/models/tool-types.kern` | Add `'smart'` to permissionMode union; add `sessionAllowList?: string[]` and `source?: 'user'\|'orchestrator'` to ToolContext |
| `kern/models/types.kern` | Add `'smart'` to permissionMode union in session config types |
| `kern/tools/tool-permissions.kern` | Add `checkSmartBashPermission`, `checkSmartWritePermission`, `isGitDirty`, `isSessionAllowed` helpers; update `checkBashPermission` and `checkFileWritePermission` to handle `'smart'` |
| `kern/signals/config.kern` | Change default from `'ask'` to `'smart'` |
| `kern/api/agent-loop.kern` | Pass `source: 'orchestrator'` and `sessionAllowList` in ToolContext |
| `kern/cesar/agent-session.kern` | Pass `source: 'orchestrator'` in ToolContext |
| `kern/cesar/agent-team.kern` | Pass `source: 'orchestrator'` in ToolContext |

### CLI (packages/cli)

| File | Change |
|------|--------|
| `kern/handlers/agent.kern` | Update `buildAgentApprovalCallback` for smart mode; add to session allowlist on Y approval |
| `kern/signals/output.kern` | Update permission-ask resolve handler: in smart mode, Y adds to session allowlist instead of settings.json; show `[Y] Yes [N] No [A] Always` unchanged |
| `kern/cesar/session.kern` | Pass `source: 'orchestrator'` and `sessionAllowList` in ToolContext |
| `kern/surfaces/app.kern` | No UI changes needed — same Y/N/Always prompt, behavior differs underneath |

## Git-Dirty Check Implementation

```typescript
// Lazy, cached, session-scoped
let _gitDirtyFiles: Set<string> | null = null;
let _gitDirtyCwd: string | null = null;

function getGitDirtyFiles(cwd: string): Set<string> {
  if (_gitDirtyFiles && _gitDirtyCwd === cwd) return _gitDirtyFiles;
  try {
    const { execSync } = require('node:child_process');
    const raw = execSync('git diff --name-only && git diff --cached --name-only', { cwd, encoding: 'utf-8', timeout: 2000 });
    _gitDirtyFiles = new Set(raw.split('\n').filter(Boolean));
    _gitDirtyCwd = cwd;
  } catch {
    _gitDirtyFiles = new Set();
    _gitDirtyCwd = cwd;
  }
  return _gitDirtyFiles;
}
```

Cache invalidated on any Edit/Write execution (since the file becomes dirty).

## Acceptance Criteria

1. `permissionMode: 'smart'` auto-approves read-only commands, git-dirty file edits, and orchestrator-sourced tool calls
2. Y in smart mode adds command to session allowlist (memory only, not settings.json)
3. A (Always) still writes to settings.json as before
4. Dangerous commands are still denied regardless of mode
5. Existing `'ask'` and `'auto'` modes unchanged
6. Default for new installs is `'smart'`; existing installs keep their configured mode
7. Typecheck passes, existing tests pass
8. No new permission prompts for forge/agent tool loops in smart mode
