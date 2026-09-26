'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeReminders, shouldDeliverReminder } = require('./reminder-store');

test('native reminder input rejects stale and malformed entries and sorts valid ones', () => {
  const now = 1000000;
  const item = (id, at) => ({ id, at, title: 'TimeSprout', body: 'Task' });
  assert.deepEqual(normalizeReminders([item('later', now + 2000), item('old', now), item('sooner', now + 1000), item('sooner', now + 1000), item('too-far', now + 9 * 86400000)], now).map(x => x.id), ['sooner', 'later']);
});

test('native reminder input retains valid entries beyond the old 256 item cap', () => {
  const now = 1000000;
  const reminders = Array.from({ length: 300 }, (_, index) => ({
    id: `reminder-${index}`,
    at: now + index + 1,
    title: 'TimeSprout',
    body: 'Task'
  }));
  assert.equal(normalizeReminders(reminders, now).length, 300);
});

test('Windows drops reminders that are more than five minutes late', () => {
  const now = 1000000;
  assert.equal(shouldDeliverReminder({ at: now - 5 * 60 * 1000 }, now), true);
  assert.equal(shouldDeliverReminder({ at: now - 5 * 60 * 1000 - 1 }, now), false);
  assert.equal(shouldDeliverReminder({ at: now + 1 }, now), false);
});

test('restoring reminders keeps a recent missed alert for delivery after restart', () => {
  const now = 1000000;
  const item = at => ({ id: `at-${at}`, at, title: 'TimeSprout', body: 'Task' });
  assert.deepEqual(
    normalizeReminders([item(now - 5 * 60 * 1000), item(now - 5 * 60 * 1000 - 1)], now, true).map(entry => entry.at),
    [now - 5 * 60 * 1000]
  );
});
