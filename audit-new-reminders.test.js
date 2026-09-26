'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Android reminder restoration remains registered for system events but private to other apps', () => {
  const manifest = fs.readFileSync(path.join(__dirname, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const receiver = manifest.match(/<receiver\b[^>]*android:name="\.RescheduleReceiver"[^>]*>[\s\S]*?<\/receiver>/)?.[0];
  assert.ok(receiver, 'reschedule receiver must remain registered');
  assert.match(receiver, /android:exported="false"/, 'other apps must not be able to target the receiver');
  for (const action of [
    'android.intent.action.BOOT_COMPLETED',
    'android.intent.action.TIME_SET',
    'android.intent.action.TIMEZONE_CHANGED',
    'android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED'
  ]) assert.ok(receiver.includes(`android:name="${action}"`), `${action} must still restore reminders`);
});

test('native reminder synchronization keeps the earliest entries when a plan contains thousands of events', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({
    settings: { wake: '07:00', sleep: '22:30', play: 0 },
    events: Array.from({ length: 5000 }, (_, index) => ({
      id: `event-${index}`, title: 'Event', start: '2030-08-26T09:00:00', end: '2030-08-26T10:00:00'
    })),
    tasks: [{ id: 'due-task', title: 'Due task', duration: 10, status: 'pending', due: '2030-08-26T08:30:00' }]
  });
  const entries = planner.nativeReminderEntries(state, '2030-08-26T08:00:00');
  assert.equal(entries.length, 8192);
  assert.ok(entries.some(entry => entry.id === 'overdue:due-task:2030-08-26T08:30:00'));
  assert.ok(entries.every((entry, index) => index === 0 || entries[index - 1].at <= entry.at));
});

test('N02 native reminders include due events through the full 168-hour window', () => {
  const planner = loadPlanner();
  const now = '2026-09-25T09:00:00';
  const state = planner.normalizeState({
    settings: { wake: '07:00', sleep: '22:30', play: 0 },
    events: [
      { id: 'day-seven-event', title: 'Day seven', start: '2026-10-02T08:00:00', end: '2026-10-02T08:30:00' },
      { id: 'at-window-end', title: 'At the 168-hour boundary', start: '2026-10-02T09:00:00', end: '2026-10-02T09:30:00' }
    ]
  });
  const entries = planner.nativeReminderEntries(state, now);
  assert.ok(entries.some(item => item.id.startsWith('day-seven-event:2026-10-02T08:00:00:')));
  assert.ok(entries.some(item => item.id.startsWith('at-window-end:2026-10-02T09:00:00:')));
  assert.ok(entries.every(item => item.at <= Date.parse('2026-10-02T09:00:00')));
});

test('N03 native bridge attempts a serialized plan larger than the former 500000-character limit', async () => {
  let received = '', attempts = 0;
  global.TimeSproutNative = { syncReminders: async json => { received = json; attempts++; if (attempts === 1) return false; if (attempts === 2) throw new Error('temporary bridge failure'); return true; } };
  const eventDates = [1, 2].map(offset => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  const events = Array.from({ length: 2000 }, (_, index) => {
    const day = eventDates[index < 1000 ? 0 : 1];
    const minute = index % 1000;
    const hour = 7 + Math.floor(minute / 60);
    const clock = `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
    const end = `${String(hour).padStart(2, '0')}:${String((minute + 1) % 60).padStart(2, '0')}:00`;
    return { id: `event-${index}`, title: `Routine item ${index} ${'x'.repeat(150)}`, start: `${day}T${clock}`, end: `${day}T${end}` };
  });
  const planner = loadPlanner({ settings: { wake: '07:00', sleep: '22:30', play: 0 }, events });
  assert.equal(await planner.syncNativeReminders(), false);
  assert.equal(await planner.syncNativeReminders(), false);
  assert.equal(await planner.syncNativeReminders(), true);
  assert.equal(attempts, 3, 'rejected and failed schedules must not be cached as synchronized');
  assert.ok(received.length > 500000, `expected a large serialized plan, got ${received.length} chars`);
  const windowsMain = fs.readFileSync(path.join(__dirname, 'windows/main.js'), 'utf8');
  assert.doesNotMatch(windowsMain, /json\.length\s*>\s*500000/);
  assert.match(windowsMain, /ipcMain\.handle\('timesprout:reminders'/);
  assert.match(windowsMain, /if \(!persist\(\)\).*return false/s);
  assert.match(fs.readFileSync(path.join(__dirname, 'windows/preload.js'), 'utf8'), /return ipcRenderer\.invoke\('timesprout:reminders'/);
  const scheduler = fs.readFileSync(path.join(__dirname, 'android/app/src/main/java/top/dffapi/timesprout/ReminderScheduler.java'), 'utf8');
  assert.doesNotMatch(scheduler, /json\.length\(\)\s*>\s*500000/);
  assert.match(scheduler, /static boolean replace\(Context context, String json\)/);
  assert.match(scheduler, /delivered\.contains\(id\)/);
  assert.match(scheduler, /markDelivered\(Context context, String id\)/);
  assert.match(fs.readFileSync(path.join(__dirname, 'android/app/src/main/java/top/dffapi/timesprout/MainActivity.java'), 'utf8'), /public boolean syncReminders\(String json\)/);
  assert.match(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), /'reminder\.syncFailed'/);
});

test('N04 a task scheduled to start in the current minute gets one immediate start alert', () => {
  const planner = loadPlanner();
  const now = '2026-09-25T09:00:20';
  const state = planner.normalizeState({
    settings: { wake: '07:00', sleep: '22:30', play: 0 },
    tasks: [{ id: 'starts-now', title: 'Starts now', duration: 45, due: '2026-09-25T10:00:00', date: '2026-09-25', status: 'pending' }]
  });
  const entries = planner.nativeReminderEntries(state, now);
  const starts = entries.filter(item => item.id.startsWith('starts-now:') && item.id.endsWith(':start'));
  assert.equal(starts.length, 1, JSON.stringify({ blocks: planner.planForDate(state, '2026-09-25', now).blocks, entries }));
  assert.ok(starts[0].at > Date.parse(now));
  assert.ok(starts[0].at <= Date.parse('2026-09-25T09:01:00'));
  const nextMinute = planner.nativeReminderEntries(state, '2026-09-25T09:01:20').find(item => item.id.endsWith(':start') && item.id.startsWith('starts-now:'));
  assert.ok(nextMinute);
  assert.equal(nextMinute.id, starts[0].id, 'a replan in the next minute must retain the task/due reminder identity');
  assert.ok(nextMinute.at > Date.parse('2026-09-25T09:01:20'));
});

test('N11 a queued reminder survives editing after its active interval ends', () => {
  const planner = loadPlanner();
  const key = 'task:2026-09-25T09:00:00:reminder.startsSoon:09:00:Task';
  const queue = [{ key, message: 'Task starts soon' }];
  const preserved = planner.pruneReminderState(queue, new Set([key]), [], true);
  assert.deepEqual(preserved.queue, queue);
  assert.deepEqual([...preserved.keys], [key]);
  const backlog = Array.from({ length: 5 }, (_, index) => ({ key: `${key}:${index}`, message: `Reminder ${index}` }));
  const firstBatch = planner.takeReminderBatch(backlog, 3);
  const nextTick = planner.pruneReminderState(firstBatch.remaining, new Set(firstBatch.remaining.map(item => item.key)), [], true);
  assert.equal(nextTick.queue.length, 2, 'the deferred marker must keep stale backlog alive until all batches display');
  const clearedAfterDisplay = planner.pruneReminderState(queue, new Set([key]), [], false);
  assert.deepEqual(clearedAfterDisplay.queue, []);
});

test('R03 a deferred event reminder is removed when its source is deleted or replaced', () => {
  const planner = loadPlanner();
  const event = { id: 'meeting', title: 'Meeting', start: '2026-09-25T09:00:00', end: '2026-09-25T10:00:00', kind: 'event' };
  const queue = [{ key: 'meeting:start', message: 'Meeting starts soon', eventId: event.id, eventTitle: event.title, eventStart: event.start, eventEnd: event.end, eventKind: event.kind }];
  assert.deepEqual(planner.pruneDeferredReminderQueue(queue, [], [event], []), queue);
  assert.deepEqual(planner.pruneDeferredReminderQueue(queue, [], [], []), []);
  assert.deepEqual(planner.pruneDeferredReminderQueue(queue, [], [{ ...event, title: 'Another meeting' }], []), []);
});

test('R03 a deferred course reminder is removed when that lesson changes', () => {
  const planner = loadPlanner();
  const course = { id: 'math', title: 'Math', day: 5, start: '09:00', end: '10:00', location: 'Room 1' };
  const queue = [{ key: 'math:start', message: 'Math starts soon', courseId: course.id, courseTitle: course.title, courseDay: course.day, courseStart: course.start, courseEnd: course.end, courseLocation: course.location }];
  assert.deepEqual(planner.pruneDeferredReminderQueue(queue, [], [], [course]), queue);
  assert.deepEqual(planner.pruneDeferredReminderQueue(queue, [], [], []), []);
  assert.deepEqual(planner.pruneDeferredReminderQueue(queue, [], [], [{ ...course, start: '09:30' }]), []);
});

test('R03 clearing a plan removes a fixed-event reminder deferred during editing', () => {
  const RealDate = global.Date;
  const realSetInterval = global.setInterval;
  const now = RealDate.parse('2026-09-25T09:00:20');
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  let reminderTick;
  global.setInterval = (callback, delay) => { if (delay === 30000) reminderTick = callback; return 1; };
  global.localStorage = { getItem: () => JSON.stringify({ settings: { wake: '07:00', sleep: '22:30', play: 0 }, events: [{ id: 'meeting', title: 'Meeting', start: '2026-09-25T09:05:00', end: '2026-09-25T09:35:00', kind: 'event' }] }), setItem() {} };
  global.document = { documentElement: { dataset: {} }, addEventListener() {}, querySelector: () => ({ querySelector: () => null }), activeElement: { matches: () => true } };
  let script = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  script = script.replace('function renderApp(){', 'function renderApp(){return;');
  script = script.replace('let persistedState=JSON.stringify(state);', "lastRenderedPlanningDate='2026-09-25';globalThis.__r03={queue:()=>reminderQueue,notice:()=>notice,clearEvents:()=>{state={...state,events:[]}}};let persistedState=JSON.stringify(state);");
  try {
    eval(script);
    reminderTick();
    assert.ok(global.__r03.queue().some(item => item.eventId === 'meeting'));
    global.__r03.clearEvents();
    global.document.activeElement = { matches: () => false };
    reminderTick();
    assert.deepEqual(global.__r03.queue(), []);
    assert.equal(global.__r03.notice(), '');
  } finally {
    global.Date = RealDate;
    global.setInterval = realSetInterval;
    delete global.document;
    delete global.__r03;
  }
});

function loadPlanner(saved) {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  global.localStorage = { getItem: () => JSON.stringify(saved || { settings: { language: 'en' } }), setItem: () => {} };
  delete global.document;
  delete global.AgendaPlanner;
  eval(script);
  return global.AgendaPlanner;
}
