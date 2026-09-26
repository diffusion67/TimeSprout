const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function planner() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  global.localStorage = { getItem: () => null, setItem() {} };
  delete global.document;
  eval(script);
  return global.AgendaPlanner;
}

test('N07 historical allocation excludes undated work with no historical schedule', () => {
  const p = planner();
  const state = p.normalizeState({
    settings: { wake: '07:00', sleep: '22:30', play: 0 },
    tasks: [{ id: 'new-work', title: 'New work', duration: 30, due: '2026-09-25T22:30:00', status: 'pending' }]
  });
  assert.equal(p.analyticsAllocation(state, '2026-09-01', '2026-09-25T12:00:00').tasks, 0);
  assert.equal(p.analyticsAllocation(state, '2026-09-25', '2026-09-25T12:00:00').tasks, 30);
});

test('N08 protected daily play follows every scheduled work block', () => {
  const p = planner();
  const result = p.schedule({
    date: '2026-09-25', now: '2026-09-25T19:00:00', dayStart: '19:00', dayEnd: '22:30',
    fixed: [
      { id: 'break', title: 'Break', start: '2026-09-25T19:15:00', end: '2026-09-25T19:20:00', kind: 'event' },
      { id: 'fixed', title: 'Fixed', start: '2026-09-25T21:00:00', end: '2026-09-25T22:00:00', kind: 'event' }
    ],
    tasks: [
      { id: 'work-a', title: 'Work A', duration: 30, due: '2026-09-25T22:30:00' },
      { id: 'work-b', title: 'Work B', duration: 30, due: '2026-09-25T22:30:00' },
      { id: 'daily-play', title: 'Play', duration: 60, due: '2026-09-25T22:30:00', leisure: true, required: true }
    ]
  });
  const play = result.blocks.find(block => block.id === 'daily-play');
  assert.ok(play);
  const work = result.blocks.filter(block => block.kind === 'task' && !block.leisure);
  assert.equal(work.length, 1);
  assert.ok(work.every(block => block.end <= play.start));
  assert.equal(result.unscheduled.filter(task => !task.leisure).length, 1);
});

test('Q01 delaying after bedtime uses the next planning-day deadline', () => {
  const p = planner();
  const delayed = p.delayTask(
    { id: 'old', date: '2026-09-01', due: '2026-09-01T22:30:00', status: 'pending' },
    '2026-09-25T23:00:00', '07:00', '22:30'
  );
  assert.equal(delayed.due, '2026-09-26T22:30:00');
  assert.equal(delayed.date, '2026-09-26');
});
