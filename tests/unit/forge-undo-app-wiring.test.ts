import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../../packages/cli/src/surfaces/app.tsx', import.meta.url), 'utf8');

// Structural boundary check: handler tests execute the callback, while this
// checks that the real React host supplies it and refreshes the submit closure.
function inspectUndoWiring(text: string) {
  const file = ts.createSourceFile('app.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let providesSetter = false;
  let refreshesSubmit = false;
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isCallExpression(node.initializer)) {
      if (node.name.text === 'buildContext') {
        const callback = node.initializer.arguments[0];
        if (callback) {
          const findSetter = (child: ts.Node): void => {
            if (ts.isShorthandPropertyAssignment(child) && child.name.text === 'setLastUndoToken') providesSetter = true;
            ts.forEachChild(child, findSetter);
          };
          findSetter(callback);
        }
      }
      if (node.name.text === 'handleSubmit') {
        const deps = node.initializer.arguments[1];
        refreshesSubmit = !!deps && ts.isArrayLiteralExpression(deps)
          && deps.elements.some(item => ts.isIdentifier(item) && item.text === 'lastUndoToken');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { providesSetter, refreshesSubmit };
}

it('connects Forge undo to the app and refreshes the submit closure', () => {
  expect(inspectUndoWiring(source)).toEqual({ providesSetter: true, refreshesSubmit: true });
});

it('detects removal of the host setter', () => {
  const mutated = source.replace('setCurrentPlan, setLastUndoToken, setActiveAbort:', 'setCurrentPlan, setActiveAbort:');
  expect(mutated).not.toBe(source);
  expect(inspectUndoWiring(mutated).providesSetter).toBe(false);
});

it('detects a stale undo token in the submit closure', () => {
  const mutated = source.replace('awaitingPlanAnnouncedRef,lastUndoToken]', 'awaitingPlanAnnouncedRef]');
  expect(mutated).not.toBe(source);
  expect(inspectUndoWiring(mutated).refreshesSubmit).toBe(false);
});
