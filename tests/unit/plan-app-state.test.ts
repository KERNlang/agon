import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

it('updates the real app plan reference before its queued render', () => {
  const source = readFileSync(new URL('../../packages/cli/src/surfaces/app.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map<string, string>();
  let getter = '';
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && ['currentPlanRef', 'setCurrentPlan'].includes(node.name.text)) {
      declarations.set(node.name.text, `const ${node.getText(file)};`);
    }
    if (ts.isGetAccessorDeclaration(node) && node.name.getText(file) === 'currentPlan') getter = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(declarations.size).toBe(2);
  expect(getter).not.toBe('');
  const code = ts.transpileModule([...declarations.values(),
    `return { setCurrentPlan, ${getter} };`].join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const renders: Array<() => void> = [];
  const render = vi.fn();
  const host = new Function('useRef', 'useMemo', '__inkSafe', '_setCurrentPlanRaw', code)(
    (value: unknown) => ({ current: value }), (factory: () => unknown) => factory(),
    (setter: (value: unknown) => void) => (value: unknown) => renders.push(() => setter(value)), render,
  );
  const draft = { id: 'shown', state: 'draft' };
  host.setCurrentPlan(draft);
  expect(host.currentPlan).toBe(draft);
  expect(render).not.toHaveBeenCalled();
  const cancelled = { ...draft, state: 'cancelled' };
  host.setCurrentPlan(cancelled);
  expect(host.currentPlan).toBe(cancelled);
  for (const queued of renders.splice(0)) queued();
  expect(render.mock.calls.map(([value]) => value)).toEqual([draft, cancelled]);
  host.setCurrentPlan(null);
  expect(host.currentPlan).toBeNull();
});
