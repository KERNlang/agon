import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('forwards the job-owned signal in normal, recovered and fallback Brainstorm launches', () => {
  const source = readFileSync(new URL('../../packages/cli/src/signals/dispatch/cesar-router.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('router.ts', source, ts.ScriptTarget.Latest, true);
  let launches = 0;
  function inspect(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'withThreadOutcome'
      && node.arguments[1]?.getText(file) === "'brainstorm'") {
      launches++;
      const callback = node.arguments[3];
      expect(ts.isArrowFunction(callback)).toBe(true);
      if (!ts.isArrowFunction(callback)) return;
      const name = callback.parameters[0]?.name.getText(file);
      expect(name, 'job callback must accept its AbortSignal').toBeDefined();
      let forwarded = 0;
      function visit(child: ts.Node) {
        if (ts.isCallExpression(child) && child.expression.getText(file) === 'runPhysicalCesarWorkflow'
          && child.arguments[0]?.getText(file) === "'brainstorm'") {
          expect(child.arguments[3]?.getText(file)).toBe(name);
          forwarded++;
        }
        ts.forEachChild(child, visit);
      }
      visit(callback.body);
      expect(forwarded).toBe(1);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(file);
  expect(launches).toBe(3);
});
