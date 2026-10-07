import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlainObject,
  validateAllowedFields,
  isBoundedString,
  isIntegerInRange,
  isOneOf
} from '../src/middleware/validation.js';

test('isPlainObject accepts JSON objects and rejects arrays/null/primitives', () => {
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject(Object.create(null)), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject('x'), false);
});

test('validateAllowedFields rejects non-object bodies and unknown fields', () => {
  assert.equal(validateAllowedFields([], ['name']), 'Request body must be a JSON object');
  assert.equal(validateAllowedFields({ name: 'A', role: 'admin' }, ['name']), 'Unexpected field: role');
  assert.equal(validateAllowedFields({ name: 'A' }, ['name']), null);
});

test('isBoundedString validates type and trimmed bounds', () => {
  assert.equal(isBoundedString('  hello  ', { min: 1, max: 5 }), true);
  assert.equal(isBoundedString('', { min: 1, max: 5 }), false);
  assert.equal(isBoundedString({ value: 'hello' }, { min: 1, max: 20 }), false);
  assert.equal(isBoundedString('abcdef', { min: 1, max: 5 }), false);
});

test('isIntegerInRange does not coerce numeric strings or booleans', () => {
  assert.equal(isIntegerInRange(3, { min: 0, max: 5 }), true);
  assert.equal(isIntegerInRange('3', { min: 0, max: 5 }), false);
  assert.equal(isIntegerInRange(true, { min: 0, max: 5 }), false);
  assert.equal(isIntegerInRange(6, { min: 0, max: 5 }), false);
});

test('isOneOf requires an exact enum value', () => {
  assert.equal(isOneOf('with_buffet', ['with_buffet', 'without_buffet']), true);
  assert.equal(isOneOf('with-buffet', ['with_buffet', 'without_buffet']), false);
  assert.equal(isOneOf(undefined, ['x'], { optional: true }), true);
});
