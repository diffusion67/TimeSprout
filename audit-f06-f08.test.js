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

test('F06 historical allocation includes recorded completed minutes and dated pending work', () => {
  const p = planner();
  const state = p.normalizeState({
    settings: { wake: '07:00', sleep: '22:30', play: 0 },
    analytics: { daily: { '2026-09-01': { completedTaskCount: 1, completedTaskMinutes: 30, focusSeconds: 0 } } },
    tasks: [
      { id: 'done', title: 'Done', duration: 30, date: '2026-09-01', due: '2026-09-01T20:00:00', status: 'completed', completed: true },
      { id: 'pending', title: 'Pending', duration: 20, date: '2026-09-01', due: '2026-09-01T20:00:00', status: 'pending' }
    ]
  });
  assert.equal(p.analyticsAllocation(state, '2026-09-01', '2026-09-25T12:00:00').tasks, 50);
});

test('F08 legacy local fractional minutes round up while fractional backups reject', () => {
  const p = planner();
  const source = p.normalizeState({ settings: { wake: '07:00', sleep: '22:30' } });
  source.tasks = [{ id: 'fractional', title: 'Fractional', duration: 0.5, date: '2026-09-25', due: '2026-09-25T20:00:00', status: 'pending' }];
  assert.equal(p.normalizeState(source).tasks[0].duration, 1);
  assert.deepEqual(p.parseBackup(`TimeSprout backup v2\n${JSON.stringify(source)}`), { ok: false, error: 'invalid-state' });
});
