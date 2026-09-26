'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('F01 immediate native start reminder preserves seconds and leaves receiver setup time', () => {
  const planner = loadPlanner();
  const now = '2026-09-25T09:00:20';
  const state = planner.normalizeState({
    settings: { wake: '07:00', sleep: '22:30', play: 0 },
    tasks: [{ id: 'starts-now', title: 'Starts now', duration: 45, due: '2026-09-25T10:00:00', date: '2026-09-25', status: 'pending' }]
  });
  const start = planner.nativeReminderEntries(state, now).find(item => item.id.startsWith('starts-now:') && item.id.endsWith(':start'));
  assert.ok(start, 'an immediate start reminder should be scheduled');
  assert.equal(start.localAt, '2026-09-25T09:00:30', 'the reminder should retain seconds and allow bridge/receiver setup time');
  assert.ok(start.at > Date.parse(now));
});

test('F01 production sync passes real seconds through to the native bridge', async () => {
  const RealDate = global.Date;
  const now = new RealDate('2026-09-25T09:00:20');
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    static now() { return now.getTime(); }
  };
  let received;
  global.TimeSproutNative = { syncReminders: async json => { received = JSON.parse(json); return true; } };
  const planner = loadPlanner({ settings: { language: 'en', wake: '07:00', sleep: '22:30', play: 0 }, tasks: [{ id: 'starts-now', title: 'Starts now', duration: 30, due: '2026-09-25T10:00:00', date: '2026-09-25', status: 'pending' }] });
  try {
    assert.equal(await planner.syncNativeReminders(), true);
    const start = received.find(item => item.id.startsWith('starts-now:') && item.id.endsWith(':start'));
    assert.ok(start, JSON.stringify(received));
    assert.equal(start.localAt, '2026-09-25T09:00:30');
    assert.ok(start.at > now.getTime(), `bridge received an already expired alert at ${start.localAt}`);
  } finally {
    global.Date = RealDate;
    delete global.TimeSproutNative;
  }
});

test('R02 native sync replaces an immediate alert lost during bridge delay in the same minute', async () => {
  const RealDate = global.Date;
  let now = RealDate.parse('2026-09-25T09:00:20');
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const received = [];
  global.TimeSproutNative = { syncReminders: json => {
    const entries = JSON.parse(json);
    received.push(entries);
    if (received.length === 1) now = RealDate.parse('2026-09-25T09:00:36');
    return Promise.resolve(true);
  } };
  const planner = loadPlanner({ settings: { language: 'en', wake: '07:00', sleep: '22:30', play: 0 }, tasks: [{ id: 'starts-now', title: 'Starts now', duration: 30, due: '2026-09-25T10:00:00', date: '2026-09-25', status: 'pending' }] });
  const startAlert = entries => entries.find(item => item.id.startsWith('starts-now:') && item.id.endsWith(':start'));
  try {
    assert.equal(await planner.syncNativeReminders(), true);
    assert.equal(startAlert(received[0]).localAt, '2026-09-25T09:00:30');
    assert.ok(startAlert(received[0]).at <= now, 'the first alert expired before the receiver processed it');
    assert.equal(await planner.syncNativeReminders(), true);
    assert.equal(received.length, 2, 'a new immediate alert must be sent even within the same minute');
    assert.equal(startAlert(received[1]).localAt, '2026-09-25T09:00:46');
    assert.ok(startAlert(received[1]).at > now);
  } finally {
    global.Date = RealDate;
    delete global.TimeSproutNative;
  }
});

test('F02 an undated task gets stable but distinct native start ids on each planning day', () => {
  const planner = loadPlanner();
  const now = '2026-09-25T00:00:00';
  const state = planner.normalizeState({
    settings: { wake: '07:00', sleep: '22:30', play: 0 },
    tasks: [{ id: 'multi-day', title: 'Multi-day task', duration: 30, due: '2026-10-02T22:30:00', status: 'pending' }]
  });
  const starts = planner.nativeReminderEntries(state, now).filter(item => item.id.startsWith('multi-day:') && item.id.endsWith(':start'));
  const first = starts.find(item => item.localAt.startsWith('2026-09-25T'));
  const second = starts.find(item => item.localAt.startsWith('2026-09-26T'));
  assert.ok(first, JSON.stringify(starts));
  assert.ok(second, JSON.stringify(starts));
  assert.notEqual(first.id, second.id, 'planning-day reminder identities must not collapse in the shared seen set');

  const nextPlanningPass = planner.nativeReminderEntries(state, '2026-09-25T00:01:00');
  assert.equal(nextPlanningPass.find(item => item.localAt === first.localAt)?.id, first.id, 'the same planning day must retain its id after replanning');
});

test('F07 concurrent native syncs merge identical work, queue changed state, and allow retry after failure', async () => {
  const restoreClock = useFixedClock('2026-09-25T09:00:20');
  const first = deferred();
  const changed = deferred();
  const calls = [];
  global.TimeSproutNative = { syncReminders: json => { calls.push(JSON.parse(json)); return calls.length === 1 ? first.promise : calls.length === 2 ? changed.promise : Promise.resolve(true); } };
  const planner = loadPlanner({ settings: { language: 'en', wake: '07:00', sleep: '22:30', play: 0 }, tasks: [{ id: 'sync-task', title: 'Original', duration: 30, due: '2026-09-25T10:00:00', date: '2026-09-25', status: 'pending' }] }, true);
  try {
    const one = planner.syncNativeReminders();
    const duplicate = planner.syncNativeReminders();
    await Promise.resolve();
    assert.equal(calls.length, 1, 'same-signature callers should share one bridge request');
    assert.equal(one, duplicate, 'same-signature callers should receive the same in-flight promise');

    global.__testSetState({ settings: { language: 'en', wake: '07:00', sleep: '22:30', play: 0 }, tasks: [{ id: 'sync-task', title: 'Updated', duration: 30, due: '2026-09-25T10:00:00', date: '2026-09-25', status: 'pending' }] });
    const update = planner.syncNativeReminders();
    assert.equal(calls.length, 1, 'changed schedules should wait for the current bridge request');
    first.resolve(true);
    assert.equal(await one, true);
    await Promise.resolve();
    assert.equal(calls.length, 2, 'the latest changed schedule should be sent after the active request finishes');
    assert.match(calls[1].find(item => item.id.startsWith('sync-task:') && item.id.endsWith(':start')).body, /Updated/);
    changed.resolve(false);
    assert.equal(await update, false, 'a rejected latest schedule should be reported as a failure');

    const retry = planner.syncNativeReminders();
    assert.equal(await retry, true, 'a failed schedule must not be cached and should be retryable');
    assert.equal(calls.length, 3);
  } finally {
    restoreClock();
    delete global.TimeSproutNative;
    delete global.__testSetState;
  }
});

test('F07 a change reverted during sync does not send a stale queued schedule', async () => {
  const restoreClock = useFixedClock('2026-09-25T09:00:20');
  const first = deferred();
  const calls = [];
  global.TimeSproutNative = { syncReminders: json => { calls.push(JSON.parse(json)); return first.promise; } };
  const original = { settings: { language: 'en', wake: '07:00', sleep: '22:30', play: 0 }, tasks: [{ id: 'sync-task', title: 'Original', duration: 30, due: '2026-09-25T10:00:00', date: '2026-09-25', status: 'pending' }] };
  const planner = loadPlanner(original, true);
  try {
    const inFlight = planner.syncNativeReminders();
    await Promise.resolve();
    global.__testSetState({ ...original, tasks: [{ ...original.tasks[0], title: 'Temporary' }] });
    const superseded = planner.syncNativeReminders();
    global.__testSetState(original);
    const restored = planner.syncNativeReminders();
    first.resolve(true);
    assert.equal(await inFlight, true);
    assert.equal(await superseded, true);
    assert.equal(await restored, true);
    assert.equal(calls.length, 1, 'the device should remain on the latest restored plan without a stale follow-up');
  } finally {
    restoreClock();
    delete global.TimeSproutNative;
    delete global.__testSetState;
  }
});

function useFixedClock(nowValue) {
  const RealDate = global.Date;
  const now = RealDate.parse(nowValue);
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  return () => { global.Date = RealDate; };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function loadPlanner(saved, exposeState = false) {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  if (exposeState) script = script.replace('let state=load(), tab=', 'let state=load();globalThis.__testSetState=value=>{state=normalizeState(value)};let tab=');
  global.localStorage = { getItem: () => JSON.stringify(saved || { settings: { language: 'en' } }), setItem: () => {} };
  delete global.document;
  delete global.AgendaPlanner;
  eval(script);
  return global.AgendaPlanner;
}
