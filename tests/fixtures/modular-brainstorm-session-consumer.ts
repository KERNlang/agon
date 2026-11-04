import { createBrainstormPresentation, runBrainstormSession } from '@kernlang/agon-mod-brainstorm';
import type { BrainstormPresentationHost } from '@kernlang/agon-mod-brainstorm';

declare const host: Parameters<typeof runBrainstormSession>[2];
declare const execute: Parameters<typeof runBrainstormSession>[3];
declare const signal: AbortSignal;

// A caller cannot promise an arbitrary result type without validating it.
// @ts-expect-error The physical session has a concrete result, not a caller-selected generic.
runBrainstormSession<number>({ question: 'fixture' }, signal, host, execute);

export const result = runBrainstormSession({ question: 'fixture' }, signal, host, execute);

declare const presentationHost: BrainstormPresentationHost;
export const presentation = createBrainstormPresentation(presentationHost);
// @ts-expect-error A scheduler must provide cancellation, not an opaque timer number.
createBrainstormPresentation({ ...presentationHost, scheduleEvery: () => 42 });
