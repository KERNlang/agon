// A REAL test: every assertion pins an actual value, so any mutation of
// src/add.ts must be killed.
import assert from 'node:assert/strict';
import { add, isPositive } from './src/add.ts';

assert.equal(add(1, 2), 3);
assert.equal(add(10, 5), 15);
assert.equal(isPositive(1), true);
assert.equal(isPositive(-1), false);
console.log('ok');
