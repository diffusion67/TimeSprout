const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function planner() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  global.localStorage = { getItem: () => JSON.stringify({ settings: { language: 'en' } }), setItem: () => {} };
  delete global.document;
  delete global.AgendaPlanner;
  eval(script);
  return global.AgendaPlanner;
}

test('holiday range is bounded before task generation', () => {
  const p = planner();
  assert.equal(p.holidayDateRange('2026-01-01', '2028-01-01'), null);
  assert.equal(p.holidayDateRange('2026-01-01', '2026-01-02').length, 2);
  assert.equal(p.holidayDateRange('2026-01-02', '2026-01-01'), null);
});

test('delaying an old overdue task makes both deadline and dated task future', () => {
  const p = planner();
  const task = { id: 'old', date: '2026-09-01', due: '2026-09-01T22:30:00', status: 'pending' };
  const result = p.delayTask(task, '2026-09-25T12:00:00', '07:00', '22:30');
  assert.ok(new Date(result.due) > new Date('2026-09-26T12:00:00'));
  assert.equal(result.date, '2026-09-26');
});

test('overnight due time remains on the preceding planning date', () => {
  const p = planner();
  const state = p.normalizeState({ settings: { wake: '07:00', sleep: '02:00', play: 0 }, tasks: [
    { id: 'old', title: 'Old', duration: 30, date: '2026-09-01', due: '2026-09-02T02:00:00', status: 'pending' }
  ] });
  const delayed = p.delayTask(state.tasks[0], '2026-09-25T23:00:00', '07:00', '02:00');
  assert.equal(delayed.due, '2026-09-27T02:00:00');
  assert.equal(delayed.date, '2026-09-26');
});

test('default deadline after bedtime is on the next planning day', () => {
  const p = planner();
  assert.equal(p.nextTaskDue('2026-09-25T23:00:00', '07:00', '22:30'), '2026-09-26T22:30:00');
  assert.equal(p.nextTaskDue('2026-09-26T01:00:00', '07:00', '02:00'), '2026-09-26T02:00:00');
});

test('all overlapping fixed pairs are reported', () => {
  const p = planner();
  const events = ['a', 'b', 'c'].map(id => ({ id, start: '2026-09-25T10:00:00', end: '2026-09-25T11:00:00' }));
  assert.deepEqual(p.findFixedConflicts(events).map(({ firstId, secondId }) => `${firstId}:${secondId}`), ['a:b', 'a:c', 'b:c']);
});

test('overnight break protects the planning day it occupies', () => {
  const p = planner();
  const breakEvent = [{ id: 'break', oneTimeBreak: true, start: '2026-09-26T00:30:00', end: '2026-09-26T00:45:00' }];
  assert.equal(p.shouldProtectDailyPlay(breakEvent, '2026-09-25', '07:00', '02:00'), true);
  assert.equal(p.shouldProtectDailyPlay(breakEvent, '2026-09-26', '07:00', '02:00'), false);
});

test('calendar includes events in the final hour of a daylight saving rollback day', () => {
  const code = `const fs=require('fs');const s=fs.readFileSync('index.html','utf8').match(/<script>([\\s\\S]*?)<\\/script>/)[1];global.localStorage={getItem:()=>null,setItem:()=>{}};eval(s);process.stdout.write(String(global.AgendaPlanner.eventOverlapsDate({start:'2026-11-01T23:30:00',end:'2026-11-01T23:45:00'},'2026-11-01')));`;
  assert.equal(execFileSync(process.execPath, ['-e', code], { cwd: __dirname, env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' }), 'true');
});

test('historical allocation uses the selected date rather than the present clock', () => {
  const p = planner();
  const state = p.normalizeState({ settings: { wake: '07:00', sleep: '22:30', play: 0 }, tasks: [{ id: 'past', title: 'Past task', duration: 60, priority: 'high', date: '2026-09-01', due: '2026-09-01T12:00:00', status: 'pending' }] });
  assert.equal(p.analyticsAllocation(state, '2026-09-01', '2026-09-25T12:00:00').tasks, 60);
});

test('allocation counts overlap between fixed events only once', () => {
  const p = planner();
  const state = p.normalizeState({ settings: { wake: '07:00', sleep: '22:30', play: 0 }, events: [
    { id: 'a', title: 'A', start: '2026-09-25T10:00:00', end: '2026-09-25T11:00:00' },
    { id: 'b', title: 'B', start: '2026-09-25T10:30:00', end: '2026-09-25T11:30:00' }
  ] });
  assert.equal(p.analyticsAllocation(state, '2026-09-25', '2026-09-25T08:00:00').events, 90);
});

test('required daily play reserves time when work competes for the only slot', () => {
  const p = planner();
  const result = p.schedule({ date: '2026-09-25', now: '2026-09-25T08:00:00', dayStart: '08:00', dayEnd: '09:00', fixed: [], tasks: [
    { id: 'work', title: 'Work', duration: 60, due: '2026-09-25T09:00:00' },
    { id: 'daily-play', title: 'Play', duration: 60, due: '2026-09-25T09:00:00', leisure: true, required: true }
  ] });
  assert.deepEqual(result.blocks.map(block => block.id), ['daily-play']);
  assert.deepEqual(result.unscheduled.map(task => task.id), ['work']);
});

test('today view tells the user when daily play cannot fit', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const RealDate = global.Date;
  const instant = new RealDate('2026-09-25T12:00:00').getTime();
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
  const app = { innerHTML: '' };
  global.localStorage = { getItem: () => JSON.stringify({
    settings: { wake: '07:00', sleep: '22:30', play: 60, language: 'zh-CN' },
    events: [{ id: 'busy', title: 'Busy all day', start: '2026-09-25T07:00:00', end: '2026-09-25T22:30:00' }]
  }), setItem: () => {} };
  global.NodeFilter = { SHOW_TEXT: 4 };
  global.document = { documentElement: {}, activeElement: null, querySelector: () => app, querySelectorAll: () => [], createTreeWalker: () => ({ nextNode: () => null }), addEventListener: () => {} };
  global.setInterval = () => 0;
  try {
    eval(script);
    assert.match(app.innerHTML, /暂时排不下：<\/b><span>[^<]*今日玩乐时间/);
  } finally { global.Date = RealDate; delete global.document; }
});

test('fixed event times remain exact even when outside routine hours', () => {
  const p = planner();
  const state = p.normalizeState({ settings: { wake: '07:00', sleep: '22:30', play: 0 }, events: [
    { id: 'early', title: 'Early', start: '2026-09-25T06:30:00', end: '2026-09-25T07:30:00' },
    { id: 'late', title: 'Late', start: '2026-09-25T23:00:00', end: '2026-09-25T23:30:00' }
  ] });
  const blocks = p.planForDate(state, '2026-09-25', '2026-09-25T07:00:00').blocks;
  assert.deepEqual(blocks.filter(block => ['early', 'late'].includes(block.id)).map(block => [block.id, block.start, block.end]), [
    ['early', '2026-09-25T06:30:00', '2026-09-25T07:30:00'],
    ['late', '2026-09-25T23:00:00', '2026-09-25T23:30:00']
  ]);
});
