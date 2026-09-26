const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function loadPlanner() {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  global.localStorage = { getItem: () => null, setItem() {} };
  delete global.document;
  delete global.AgendaPlanner;
  eval(script);
  return global.AgendaPlanner;
}

test('F04 reminders deferred while editing are discarded after completion or rescheduling', () => {
  const planner = loadPlanner();
  const queue = [
    { key: 'task-1:active:reminder.doNow', taskId: 'task-1', taskDue: '2026-09-25T10:00:00', taskTitle: 'A', message: 'old' },
    { key: 'task-2:active:reminder.doNow', taskId: 'task-2', taskDue: '2026-09-25T10:00:00', taskTitle: 'B', message: 'old' },
    { key: 'task-3:active:reminder.doNow', taskId: 'task-3', taskDue: '2026-09-25T10:00:00', taskTitle: 'C', message: 'old' },
    { key: 'task-4:active:reminder.doNow', taskId: 'task-4', taskDue: '2026-09-25T10:00:00', taskTitle: 'D', message: 'old' },
    { key: 'routine:active:reminder.doNow', message: 'routine' }
  ];
  const tasks = [
    { id: 'task-1', due: '2026-09-25T10:00:00', title: 'A', status: 'pending' },
    { id: 'task-2', due: '2026-09-25T10:00:00', status: 'completed', completed: true },
    { id: 'task-3', due: '2026-09-26T10:00:00', title: 'C', status: 'pending' },
    { id: 'task-4', due: '2026-09-25T10:00:00', title: 'renamed', status: 'pending' }
  ];

  const kept = planner.pruneDeferredReminderQueue(queue, tasks);

  assert.deepEqual(kept.map(item => item.key), [queue[0].key, queue[4].key]);
});

test('F05 backup FileReader completion preserves unsaved settings values across redraw', () => {
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const readers = [];
  const makeControls = () => [
    { name: 'wake', type: 'time', value: '07:00' },
    { name: 'backup', type: 'file', value: '' },
    { name: 'sleep', type: 'time', value: '22:30' }
  ].map(control => ({ ...control, focus() { global.document.activeElement = this; } }));
  let controls = makeControls();
  const root = { querySelectorAll: () => controls };
  let renders = 0;
  let script = source
    .replace('function renderApp(){', `function renderApp(){renders++;controls=makeControls();global.document.activeElement=null;return;`)
    .replace('function stageBackupFile(file){', 'function stageBackupFile(file){')
    .replace(/function stageBackupFile\(file\)\{[\s\S]*?\n  function dangerConfirmationPanel/, match =>
      `${match.slice(0, match.lastIndexOf('\n  function dangerConfirmationPanel'))}\n  globalThis.__auditBackup={stageBackupFile,getPending:()=>pendingBackupImport};\n  return;\n  function dangerConfirmationPanel`);
  global.localStorage = { getItem: () => null, setItem() {} };
  global.document = { documentElement: { dataset: {} }, addEventListener() {}, querySelector: () => root, activeElement: null };
  global.FileReader = class { constructor() { readers.push(this); } readAsText() {} };
  global.__testRoot = root;
  eval(script);
  controls[0].value = '08:15';
  controls[2].value = '23:15';
  global.__auditBackup.stageBackupFile({ name: 'backup.txt', size: 10 });
  controls[2].value = '23:45';
  controls[2].focus();
  readers[0].result = global.AgendaPlanner.serializeBackup(global.AgendaPlanner.normalizeState({
    tasks: [{ id: 'imported', title: 'Imported', duration: 25 }]
  }));
  readers[0].onload();

  assert.equal(renders, 2);
  assert.equal(controls[0].value, '08:15');
  assert.equal(controls[2].value, '23:45');
  assert.equal(global.document.activeElement, controls[2], 'the edited setting should regain focus after FileReader completion');
  assert.equal(global.__auditBackup.getPending().tasks[0].id, 'imported');
  delete global.document;
  delete global.FileReader;
  delete global.__testRoot;
});

test('R04 form restoration keeps the caret in a focused text control', () => {
  const planner = loadPlanner();
  const before = { name: 'title', type: 'text', value: 'Meeting notes', selectionStart: 3, selectionEnd: 7, selectionDirection: 'forward' };
  global.document = { activeElement: before };
  const snapshot = planner.captureFormState({ querySelectorAll: () => [before] });
  const after = { name: 'title', type: 'text', value: '', focus() { global.document.activeElement = this; }, setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; } };
  planner.restoreFormState({ querySelectorAll: () => [after] }, snapshot);
  assert.equal(after.value, 'Meeting notes');
  assert.equal(global.document.activeElement, after);
  assert.deepEqual([after.selectionStart, after.selectionEnd, after.selectionDirection], [3, 7, 'forward']);
  delete global.document;
});

test('F09 analytics date follows a new planning date until the user selects a date', () => {
  const planner = loadPlanner();

  assert.equal(planner.analyticsDateForView('2026-09-26', '2026-09-25', false), '2026-09-26');
  assert.equal(planner.analyticsDateForView('2026-09-26', '2026-09-24', true), '2026-09-24');
});
