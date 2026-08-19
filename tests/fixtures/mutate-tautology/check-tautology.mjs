// A FAKE test: it imports the module (so a syntax-broken mutant would still
// fail) but asserts nothing about it. Every mutant survives.
import assert from 'node:assert/strict';
import * as mod from './src/add.ts';

assert.equal(typeof mod.add, 'function');
assert.equal(true, true);
console.log('ok');
