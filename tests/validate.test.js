'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/validate.js');

const good = { name: 'Graphs', daysLeft: '5', difficulty: '4', confidence: '2', importance: '5' };

test('sanitizeName strips control characters, angle brackets and extra spaces', () => {
  assert.equal(V.sanitizeName('  Data\u0000   Structures \n'), 'Data Structures');
  assert.equal(V.sanitizeName('<script>alert(1)</script>'), 'scriptalert(1)/script');
  assert.equal(V.sanitizeName(42), '');
  assert.equal(V.sanitizeName(null), '');
});

test('sanitizeName caps the length', () => {
  assert.equal(V.sanitizeName('x'.repeat(500)).length, V.LIMITS.nameMaxLength);
});

test('validateTopic accepts numeric strings and returns clean numbers', () => {
  const result = V.validateTopic(good);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    name: 'Graphs', daysLeft: 5, difficulty: 4, confidence: 2, importance: 5, doneBlocks: 0,
  });
});

test('validateTopic rejects missing, empty and non-object input', () => {
  assert.equal(V.validateTopic(null).ok, false);
  assert.equal(V.validateTopic('nope').ok, false);
  assert.equal(V.validateTopic({}).ok, false);
  assert.equal(V.validateTopic(Object.assign({}, good, { name: '   ' })).ok, false);
});

test('validateTopic rejects out-of-range, fractional and non-numeric values', () => {
  [
    { daysLeft: 0 },
    { daysLeft: 31 },
    { difficulty: 6 },
    { confidence: 0 },
    { importance: 2.5 },
    { daysLeft: 'abc' },
    { difficulty: '' },
    { confidence: true },
    { importance: NaN },
    { daysLeft: Infinity },
  ].forEach((patch) => {
    const result = V.validateTopic(Object.assign({}, good, patch));
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.ok(result.errors.length > 0);
  });
});

test('validateTopic does not mutate its input', () => {
  const input = Object.assign({}, good);
  V.validateTopic(input);
  assert.deepEqual(input, good);
});

test('validateContext accepts valid settings', () => {
  const result = V.validateContext({ hoursPerDay: '3.5', energy: 'HIGH' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { hoursPerDay: 3.5, energy: 'high' });
});

test('validateContext rejects bad hours and energy', () => {
  [
    { hoursPerDay: 0, energy: 'low' },
    { hoursPerDay: 13, energy: 'low' },
    { hoursPerDay: 2.25, energy: 'low' },
    { hoursPerDay: '', energy: 'low' },
    { hoursPerDay: true, energy: 'low' },
    { hoursPerDay: 2, energy: 'angry' },
    { hoursPerDay: 2 },
  ].forEach((input) => assert.equal(V.validateContext(input).ok, false, JSON.stringify(input)));
  assert.equal(V.validateContext(null).ok, false);
});

test('addTopic appends valid topics without mutating the original list', () => {
  const list = [];
  const result = V.addTopic(list, good);
  assert.equal(result.ok, true);
  assert.equal(result.topics.length, 1);
  assert.equal(list.length, 0);
});

test('addTopic rejects duplicates case-insensitively', () => {
  const first = V.addTopic([], good);
  const second = V.addTopic(first.topics, Object.assign({}, good, { name: 'GRAPHS' }));
  assert.equal(second.ok, false);
  assert.match(second.errors[0], /already/);
  assert.equal(second.topics.length, 1);
});

test('addTopic enforces the topic cap', () => {
  let list = [];
  for (let i = 0; i < V.LIMITS.maxTopics; i++) {
    list = V.addTopic(list, Object.assign({}, good, { name: 'T' + i })).topics;
  }
  const result = V.addTopic(list, Object.assign({}, good, { name: 'One too many' }));
  assert.equal(result.ok, false);
  assert.equal(result.topics.length, V.LIMITS.maxTopics);
});

test('cleanTopicList drops invalid, duplicate and non-array data', () => {
  assert.deepEqual(V.cleanTopicList('not a list'), []);
  assert.deepEqual(V.cleanTopicList(null), []);
  const cleaned = V.cleanTopicList([good, good, { name: 'bad' }, null, 7]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].name, 'Graphs');
});

test('cleanTopicList keeps valid progress and rejects tampered progress', () => {
  const ok = V.cleanTopicList([Object.assign({}, good, { doneBlocks: 2 })]);
  assert.equal(ok[0].doneBlocks, 2);
  const bad = V.cleanTopicList([Object.assign({}, good, { doneBlocks: 500 })]);
  assert.equal(bad.length, 0);
});
