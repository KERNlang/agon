// The hang case: mutating `i = i - 1` to `i = i + 1` turns the loop infinite,
// so the run must be classified as a timeout (= killed), not a survivor.
import assert from 'node:assert/strict';
import { countdown } from './src/loop.ts';

assert.equal(countdown(3), 3);
console.log('ok');
