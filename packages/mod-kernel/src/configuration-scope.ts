import { AsyncLocalStorage } from 'node:async_hooks';
import type { GenerationConfiguration } from './configuration-migration.js';

export interface InvocationConfigurationScope {
  readonly hostRoot: string;
  readonly configuration: Pick<GenerationConfiguration, 'source' | 'owners'> | undefined;
}

const scope = new AsyncLocalStorage<InvocationConfigurationScope>();

export function currentInvocationConfiguration(): InvocationConfigurationScope | undefined {
  return scope.getStore();
}

/** Bind lazy output as well as the initial call. Do not capture editable values. */
export function runWithInvocationConfiguration(selected: InvocationConfigurationScope | undefined, run: () => unknown): unknown {
  if (!selected) return run();
  const selectedScope = selected;
  function bindIterator(iterator: AsyncIterator<unknown>, factory?: () => AsyncIterator<unknown>): AsyncIterableIterator<unknown> {
    const bound: AsyncIterableIterator<unknown> = {
      next: (...args: [] | [unknown]) => scope.run(selectedScope, () => iterator.next(...args)),
      ...(iterator.return ? { return: (value?: unknown) => scope.run(selectedScope, () => iterator.return!(value)) } : {}),
      ...(iterator.throw ? { throw: (error?: unknown) => scope.run(selectedScope, () => iterator.throw!(error)) } : {}),
      [Symbol.asyncIterator]: () => scope.run(selectedScope, () => {
        const next = factory ? factory() : iterator;
        return next === iterator ? bound : bindIterator(next);
      }),
    };
    return bound;
  }
  function bind(output: unknown): unknown {
    if (!output || typeof output !== 'object') return output;
    if ('then' in output && typeof output.then === 'function') {
      return Promise.resolve(output as PromiseLike<unknown>).then(value => scope.run(selectedScope, () => bind(value)));
    }
    if (!(Symbol.asyncIterator in output) || typeof output[Symbol.asyncIterator] !== 'function') return output;
    const iterable = output as AsyncIterable<unknown>;
    if ('next' in output && typeof output.next === 'function') {
      return bindIterator(output as AsyncIterator<unknown>, () => iterable[Symbol.asyncIterator]());
    }
    return {
      [Symbol.asyncIterator]: () => scope.run(selectedScope, () => bindIterator(iterable[Symbol.asyncIterator]())),
    };
  }
  return scope.run(selectedScope, () => bind(run()));
}
