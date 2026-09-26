const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appHtmlPath = path.join(__dirname, 'index.html');

function loadPlanner(saved = {}) {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  global.localStorage = { getItem: () => JSON.stringify(saved), setItem: () => {} };
  delete global.document;
  delete global.AgendaPlanner;
  eval(script);
  return global.AgendaPlanner;
}

test('N01 undo restores plan completion stats while retaining later focus time', () => {
  const planner = loadPlanner();
  const before = planner.normalizeState({
    settings: { wake: '07:00', sleep: '22:30' },
    tasks: [{ id: 'task', title: 'Study', duration: 25, due: '2030-01-02T20:00:00', status: 'pending' }],
    analytics: { daily: { '2030-01-02': { completedTaskCount: 0, completedTaskMinutes: 0, focusSeconds: 20 } } }
  });
  let after = planner.completeTaskState(before, 'task', '2030-01-02T18:00:00');
  after = planner.recordFocusTime(after, Date.parse('2030-01-02T18:00:00'), 60);
  after.focus = { ...after.focus, totalSeconds: 60 };

  const undone = planner.restoreUndoState(after, { state: before });

  assert.equal(undone.tasks[0].status, 'pending');
  assert.equal(undone.focus.totalSeconds, 60);
  assert.deepEqual(undone.analytics.daily['2030-01-02'], {
    completedTaskCount: 0, completedTaskMinutes: 0, focusSeconds: 80
  });
  assert.equal(undone.undo, null);
});

test('N06 a due time exactly at the next-day sleep boundary belongs to the prior planning date', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({
    settings: { wake: '07:00', sleep: '02:00' },
    tasks: [{ id: 'overnight', title: 'Overnight task', duration: 25, due: '2026-09-26T02:00:00', status: 'completed', completed: true }]
  });

  const summary = planner.analyticsSummary(state, '2026-09-25T23:00:00', 7);

  assert.equal(summary.eligibleTasks, 1);
  assert.equal(summary.completedTasks, 1);
  assert.equal(summary.completionRate, 1);
});

test('N09 all actionable task lists and dashboard counts ignore completed status inconsistencies', () => {
  const planner = loadPlanner({
    settings: { wake: '07:00', sleep: '22:30', language: 'zh-CN' },
    tasks: [
      { id: 'inconsistent', title: 'Completed', duration: 25, due: '2026-09-25T09:00:00', status: 'completed', completed: false, important: true, urgent: true },
      { id: 'pending', title: 'Pending', duration: 25, due: '2026-09-25T18:00:00', status: 'pending', completed: false }
    ]
  });
  const state = planner.normalizeState({
    settings: { wake: '07:00', sleep: '22:30' },
    tasks: [
      { id: 'inconsistent', title: 'Completed', duration: 25, due: '2026-09-25T09:00:00', status: 'completed', completed: false, important: true, urgent: true },
      { id: 'pending', title: 'Pending', duration: 25, due: '2026-09-25T18:00:00', status: 'pending', completed: false }
    ]
  });

  assert.deepEqual(planner.actionableTasks(state.tasks).map(task => task.id), ['pending']);
  assert.equal(planner.entriesForDate(state, '2026-09-25').filter(item => item.type === 'task').length, 1);
  assert.equal(Object.values(planner.quadrantBuckets(state.tasks, '2026-09-25T12:00:00')).flat().length, 1);
  const dashboard = planner.buildLiveDashboardValues({ blocks: [] }, '2026-09-25T12:00:00');
  assert.equal(dashboard.pending, '1 项');
  assert.equal(dashboard.overdue, '没有逾期任务');
});

test('N10 clear-plan confirmation names cumulative focus and daily analytics records', () => {
  const planner = loadPlanner();
  const warning = planner.t('danger.clear-plan.warning', 'en');

  assert.match(warning, /focus time/i);
  assert.match(warning, /daily statistics/i);
});
