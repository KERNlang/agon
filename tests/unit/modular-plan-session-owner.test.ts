import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import * as plan from '@kernlang/agon-mod-plan';

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

it('exports the session scope from the physical Plan package', () => {
  expect(plan).toHaveProperty('withPlanSession', expect.any(Function));
  expect(plan).toHaveProperty('planSessionHost.run', expect.any(Function));
});

it('removes the CLI-owned session scope instead of retaining a second owner', () => {
  expect(existsSync(fileURLToPath(new URL('../../packages/cli/src/plan-session-host.ts', import.meta.url)))).toBe(false);
  for (const path of ['packages/cli/src/first-party-services.ts', 'packages/cli/src/signals/dispatch/intent-session.ts']) {
    expect(source(path)).not.toContain('plan-session-host.js');
    expect(source(path)).toMatch(/import\s*\{[^}]*\b(?:planSessionHost|withPlanSession)\b[^}]*\}\s*from\s*['"]@kernlang\/agon-mod-plan['"]/);
  }
});
