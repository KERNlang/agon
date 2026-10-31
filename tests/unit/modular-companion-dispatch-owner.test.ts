import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as owner from '@kernlang/agon-support-engine-runtime';
import * as legacy from '../../packages/core/src/sessions/companion-dispatch.js';

it('keeps the companion implementation unchanged at its physical owner', () => {
  const text = readFileSync(new URL('../../packages/support-engine-runtime/src/companion-dispatch.ts', import.meta.url), 'utf8');
  const declaration = "import type { DispatchResult, CompanionConfig } from './types.js';";
  expect(text).toContain(declaration);
  expect(createHash('sha256').update(text.replace(declaration, '')).digest('hex'))
    .toBe('4e513e850aede75788d4d41e6e0299a07cca92aac96db24ffe802855a0836145');
});

it('keeps Core compatibility functions identical to the public owner', () => {
  for (const name of ['companionDispatch', 'companionUsesNativeReview']) {
    const value = (owner as Record<string, unknown>)[name];
    expect(value, name).toBeTypeOf('function');
    expect((legacy as Record<string, unknown>)[name], name).toBe(value);
  }
});

it('leaves only explicit public owner exports in the Core adapter', () => {
  const text = readFileSync(new URL('../../packages/core/src/sessions/companion-dispatch.ts', import.meta.url), 'utf8');
  const code = text.replace(/\/\*\*[\s\S]*?\*\//g, '').trim();
  expect(code).toBe("export { companionDispatch, companionUsesNativeReview } from '@kernlang/agon-support-engine-runtime';\nexport type { CompanionResult, JsonRpcMessage } from '@kernlang/agon-support-engine-runtime';");
});
