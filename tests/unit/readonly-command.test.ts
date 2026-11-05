import { describe, expect, it, vi } from 'vitest';

import { buildAgentApprovalCallback } from '../../packages/cli/src/handlers/agent.js';
import { resolvePermissionDecision } from '../../packages/cli/src/cesar/permission-resolver.js';
import { createBashTool } from '../../packages/core/src/tools/tool-bash.js';
import { isReadOnlyCommand } from '../../packages/core/src/tools/tool-permissions.js';

const WRITES_OR_EXECUTES = [
  'echo x > f',
  'echo x>f',
  'cat a >> b',
  'echo x >| f',
  'ls &> f',
  'ls >& f',
  'cat <> f',
  'echo x >/dev/null/../f',
  'echo $(rm x)',
  'echo "$(rm x)"',
  'echo `rm x`',
  'echo "`rm x`"',
  'cat <(rm x)',
  'cat >(rm x)',
  "echo $'\\''$(rm x)'",
  'ls -la\nrm -rf x',
  'ls -la\r\nrm -rf x',
  'ls \\\n; rm x',
  "echo 'unterminated",
  'ls; rm x',
  'ls & rm x',
  'grep "a|b" f | rm x',
  'ls && (rm x)',
  'find . -delete',
  "find . '-delete'",
  'find . -de\\lete',
  'find . -exec rm {} +',
  'find . -execdir rm {} +',
  'find . -ok rm {} ;',
  'find . -fprint f',
  'find . -fprintf f %p',
  'find . -fls f',
  'find . ${X:--delete}',
  'find . {-delete,-print}',
  'fd -x rm',
  'fd -Hx rm',
  'fd --exec rm',
  'fd -X rm',
  'rg --pre ./x y',
  'rg --pre=./x y',
  'rg --hostname-bin=./x y',
  'ag --pager=./x y',
  'git branch -D x',
  'git branch -dr x',
  'git branch --delete x',
  'git branch -m a b',
  'git branch newbranch',
  'git diff --output=f',
  'git diff --output f',
  'git log --output=f',
  'git show --output=f',
  'git log --ext-diff',
  'date -s x',
  'date --set=x',
  'date --se=x',
  'less -o f g',
  'less --log-file=f g',
  'tree -o f',
  'file -C -m x',
  'fzf --bind start:execute(rm)',
  'fzf --preview x',
  'env X=1 rm x',
  'FOO=1 rm x',
  'FOO=1 ls',
  'timeout 5 rm x',
  'command rm x',
  'env -u ls rm x',
  'env -C ls rm x',
  'timeout -k ls 5 rm x',
  'time -o ls rm x',
  'sudo ls',
];

const STAYS_READ_ONLY = [
  'ls -la',
  'git status',
  'git log --oneline',
  'git diff HEAD~1',
  'cat a 2>/dev/null',
  'grep foo a | head -5',
  'npx tsc --noEmit 2>&1 | tail -3',
  'ls && pwd',
  'git branch',
  'git branch -a',
  "find . -name '*.ts'",
  'grep "a>b" file',
  "rg 'x|y' src",
  'grep "a;b" file',
  "grep 'a&b' file",
  'rg "^foo$" src',
  'echo \\> f',
  'echo "\\$(rm x)"',
  "echo '$(rm x)'",
  'echo $HOME',
  'wc -l < f',
  'ls &>/dev/null',
  'ls >> /dev/null',
  'ls 1>&2',
  'ls 2>/dev/null || echo none',
  'env ls',
  'git branch --merged main',
  'git branch --list "feat/*"',
  'git branch --show-current',
  'git log --format="%h|%s" --since="2 days ago"',
  'date +%s',
];

describe('isReadOnlyCommand', () => {
  it.each(WRITES_OR_EXECUTES)('%j must not skip the permission prompt as read-only', (command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
    expect(createBashTool().checkPermission!({ command }, { permissionMode: 'ask' } as never).behavior).not.toBe('allow');
  });

  it.each(STAYS_READ_ONLY)('%j must not start prompting after the hardening', (command) => {
    expect(isReadOnlyCommand(command)).toBe(true);
  });
});

describe('permission gates', () => {
  const redirect = 'echo x > f';

  it('a read-only name with an output redirect prompts in ask mode and is blocked in plan mode', async () => {
    const asked = resolvePermissionDecision({
      tool: 'Bash',
      target: redirect,
      cwd: process.cwd(),
      source: 'native',
      config: { agonPermissionMode: 'ask', allowedCommands: [], toolPermissions: {}, permissions: {} },
    });
    expect(asked).toMatchObject({ decision: 'ask', stage: 'mode' });

    const dispatch = vi.fn();
    const approve = buildAgentApprovalCallback(dispatch, {
      config: {},
      activePlan: { state: 'planning' },
    } as never, 'engine');
    expect(await approve('Bash', redirect)).toMatch(/^BLOCKED: Plan mode/);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
