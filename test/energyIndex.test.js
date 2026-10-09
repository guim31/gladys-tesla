import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIndexState, recordDailyTotal } from '../src/energyIndex.js';

test('the index grows with the day, then carries over to the next', () => {
  const state = createIndexState();
  assert.equal(recordDailyTotal(state, '2026-10-01', 5000), 5);
  assert.equal(recordDailyTotal(state, '2026-10-01', 18900), 18.9);
  assert.equal(recordDailyTotal(state, '2026-10-02', 1020), 19.92);
  assert.equal(recordDailyTotal(state, '2026-10-02', 1020), null, 'unchanged: nothing to publish');
});

test('a late correction of yesterday still lands', () => {
  const state = createIndexState();
  recordDailyTotal(state, '2026-10-01', 10000);
  recordDailyTotal(state, '2026-10-02', 2000);
  // The server finalizes yesterday after midnight.
  assert.equal(recordDailyTotal(state, '2026-10-01', 10500), 12.5);
});

test('the published index never decreases', () => {
  const state = createIndexState();
  recordDailyTotal(state, '2026-10-01', 10000);
  assert.equal(recordDailyTotal(state, '2026-10-01', 9000), null, 'downward correction held');
  assert.equal(state.published, 10);
  assert.equal(recordDailyTotal(state, '2026-10-01', 11000), 11);
});

test('old days fold into the base and are never counted twice', () => {
  const state = createIndexState();
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
  days.forEach((day) => recordDailyTotal(state, day, 1000));
  assert.equal(state.published, 5);
  assert.equal(Object.keys(state.days).length, 3);
  assert.equal(state.base, 2);
  // A replay of a folded day is ignored.
  assert.equal(recordDailyTotal(state, '2026-10-01', 4000), null);
  assert.equal(state.published, 5);
});

test('garbage is ignored', () => {
  const state = createIndexState();
  assert.equal(recordDailyTotal(state, 'yesterday', 1000), null);
  assert.equal(recordDailyTotal(state, '2026-10-01', -5), null);
  assert.equal(recordDailyTotal(state, '2026-10-01', NaN), null);
  assert.equal(state.published, null);
});
