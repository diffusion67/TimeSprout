'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('C01 native reminders cover the previous planning day across midnight', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({
    settings: { wake: '07:00', sleep: '02:00', play: 0, language: 'en' },
    events: [{ id: 'overnight-event', title: 'Night shift', start: '2026-09-25T00:30:00', end: '2026-09-25T01:10:00' }],
    tasks: [{ id: 'overnight-task', title: 'Review notes', duration: 45, due: '2026-09-25T02:00:00', date: '2026-09-24', status: 'pending' }]
  });
  const entries = planner.nativeReminderEntries(state, '2026-09-25T01:00:00');
  assert.ok(entries.some(item => item.id === 'overnight-task:2026-09-25T02:00:00:start'));
});

test('C02 queued overdue reminders are removed when due date changes', () => {
  const planner = loadPlanner();
  const oldKey = planner.overdueReminderKey({ id: 'task', due: '2026-09-24T09:00:00' });
  const newKey = planner.overdueReminderKey({ id: 'task', due: '2026-09-24T10:00:00' });
  const result = planner.pruneReminderState([{ key: oldKey, message: 'old' }], new Set([oldKey]), [newKey]);
  assert.deepEqual(result.queue, []);
  assert.deepEqual([...result.keys], []);
  assert.equal(newKey, 'overdue:task:2026-09-24T10:00:00');
});

test('C05 Today live fields continue updating while an input stays focused', () => {
  const planner = loadPlanner();
  assert.equal(planner.refreshMode(true, true, 'today'), 'live');
  assert.equal(planner.refreshMode(true, true, 'settings'), 'none');
});

test('C06 native reminder generation does not truncate plans at 256 entries', () => {
  const planner = loadPlanner();
  const date = '2026-09-24';
  const events = Array.from({ length: 130 }, (_, index) => {
    const minute = 60 + index * 6;
    const start = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
    const endMinute = minute + 5;
    const end = `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}:00`;
    return { id: `event-${index}`, title: `Event ${index}`, start: `${date}T${start}`, end: `${date}T${end}` };
  });
  const state = planner.normalizeState({ settings: { wake: '00:00', sleep: '23:59', play: 0 }, events });
  const entries = planner.nativeReminderEntries(state, `${date}T00:00:00`);
  assert.ok(entries.length > 256);
});

test('C08 native reminder signature changes as the current minute advances', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({ settings: { wake: '07:00', sleep: '22:30', play: 0 } });
  assert.notEqual(
    planner.nativeReminderSyncSignature(state, '2026-09-24T09:00:00'),
    planner.nativeReminderSyncSignature(state, '2026-09-24T09:01:00')
  );
});

test('C09 native reminder bodies are bounded to the platform limit', () => {
  const planner = loadPlanner();
  assert.equal(planner.nativeReminderBody('x'.repeat(1200)).length, 1000);
  assert.equal(planner.nativeReminderBody('short'), 'short');
});

test('C10 active task reminder keys stay stable when minute-based start time moves', () => {
  const planner = loadPlanner();
  const first = { id: 'task-1', title: 'Write report', start: '2026-09-24T09:00:00', end: '2026-09-24T09:45:00', taskId: 'task-1' };
  const shifted = { ...first, start: '2026-09-24T09:01:00', end: '2026-09-24T09:46:00' };
  assert.equal(planner.reminderKey(first, '2026-09-24T09:02:00'), planner.reminderKey(shifted, '2026-09-24T09:02:00'));
});

function loadPlanner(saved) {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  global.localStorage = { getItem: () => JSON.stringify(saved || { settings: { language: 'en' } }), setItem: () => {} };
  delete global.document;
  delete global.AgendaPlanner;
  eval(script);
  return global.AgendaPlanner;
}
