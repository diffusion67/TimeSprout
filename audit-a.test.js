const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appHtmlPath = path.join(__dirname, 'index.html');

function loadPlanner(saved, { storageWrite, native, instrumentSync = false, instrumentState = false } = {}) {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  if (instrumentSync) script = script.replace('finally{syncNativeReminders()}', 'finally{globalThis.__syncCalls=(globalThis.__syncCalls||0)+1}');
  if (instrumentState) script = script.replace('function save(){', 'globalThis.__auditState={get:()=>state,notice:()=>notice};function save(){');
  global.localStorage = {
    getItem: () => JSON.stringify(saved || {}),
    setItem: storageWrite || (() => {})
  };
  if (native) global.TimeSproutNative = native;
  else delete global.TimeSproutNative;
  delete global.document;
  delete global.AgendaPlanner;
  eval(script);
  return global.AgendaPlanner;
}

function loadBackupUi(saved, native) {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  script = script.replace('function renderApp(){', 'function renderApp(){return;');
  script = script.replace(
    'function showBackupNotice(key){notice=message(key,{},activeLanguage());renderApp()}',
    'function showBackupNotice(key){globalThis.__backupNotices.push(key)}'
  );
  script = script.replace(
    /function stageBackupFile\(file\)\{[\s\S]*?\}\n  function dangerConfirmationPanel/,
    match => match.slice(0, match.lastIndexOf('\n  function dangerConfirmationPanel')) +
      '\n  globalThis.__auditBackup={stageBackupFile,exportBackupFile,getPending:()=>pendingBackupImport};' +
      '\n  return;\n  function dangerConfirmationPanel'
  );
  global.localStorage = { getItem: () => JSON.stringify(saved || {}), setItem() {} };
  global.TimeSproutNative = native || {};
  global.document = { documentElement: { dataset: {} }, addEventListener() {} };
  global.__backupNotices = [];
  global.__auditBackup = undefined;
  eval(script);
  return global.__auditBackup;
}

function validBackup(overrides = {}) {
  return {
    settings: { wake: '07:00', sleep: '22:30', play: 60, language: 'en', theme: 'system', navigationLayout: 'top' },
    focus: { taskId: '', mode: 'focus', running: false, remainingSeconds: 1500, startedAt: '', completedPomodoros: 0, totalSeconds: 0, lastTick: 0 },
    courses: [], tasks: [], events: [], holidays: [], analytics: { daily: {} }, history: [], undo: null,
    ...overrides
  };
}

function backupText(planner, state) {
  return planner.serializeBackup(state);
}

test('A01 storage write failures are reported and do not suppress native reminder sync', () => {
  const planner = loadPlanner(validBackup(), {
    storageWrite() { throw new Error('quota exceeded'); },
    instrumentSync: true,
    instrumentState: true
  });
  global.__auditState.get().tasks.push({ id: 'unsaved', title: 'Unsaved task', duration: 30 });
  assert.equal(planner.save(), false);
  assert.equal(global.__syncCalls, 1);
  assert.deepEqual(global.__auditState.get().tasks, []);
  assert.match(global.__auditState.notice(), /save|保存/i);
});

test('A02 exports stop at the same 5 MiB limit enforced by imports', async () => {
  let exported = false;
  const oversized = validBackup({ tasks: [{ id: 'large', title: 'x'.repeat(5 * 1024 * 1024), duration: 30 }] });
  const ui = loadBackupUi(oversized, { exportBackup() { exported = true; return Promise.resolve(true); } });
  await ui.exportBackupFile();
  assert.equal(exported, false);
  assert.deepEqual(global.__backupNotices, ['backup.exportTooLarge']);
});

test('A03 late reads from earlier backup selections are ignored', () => {
  const readers = [];
  global.FileReader = class {
    constructor() { readers.push(this); }
    readAsText(file) { this.file = file; }
  };
  const ui = loadBackupUi();
  ui.stageBackupFile({ name: 'a.txt', size: 10 });
  ui.stageBackupFile({ name: 'b.txt', size: 10 });
  readers[1].result = backupText(loadPlanner(), validBackup({ tasks: [{ id: 'from-b', title: 'B', duration: 30 }] }));
  readers[1].onload();
  readers[0].result = backupText(loadPlanner(), validBackup({ tasks: [{ id: 'from-a', title: 'A', duration: 30 }] }));
  readers[0].onload();
  assert.equal(ui.getPending().tasks[0].id, 'from-b');
  delete global.FileReader;
});

test('A10 Windows backup write rejection produces a visible failure notice', async () => {
  const ui = loadBackupUi(validBackup(), { exportBackup() { return Promise.reject(new Error('disk full')); } });
  await ui.exportBackupFile();
  assert.deepEqual(global.__backupNotices, ['backup.exportFailed']);
});

test('A04 legacy history without IDs survives export and import', () => {
  const planner = loadPlanner();
  const source = validBackup({ history: [{ reason: '旧版记录', at: '2026-09-24T10:00:00' }] });
  const parsed = planner.parseBackup(backupText(planner, source));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.history[0].reason, '旧版记录');
  assert.equal(Object.hasOwn(parsed.state.history[0], 'id'), false);
});

test('A05 import rejects duplicate IDs across task and event collections', () => {
  const planner = loadPlanner();
  const source = validBackup({
    tasks: [{ id: 'shared-id', title: '任务', duration: 30, priority: 'medium', status: 'pending' }],
    events: [{ id: 'shared-id', title: '安排', start: '2026-09-24T10:00:00', end: '2026-09-24T11:00:00', kind: 'event' }]
  });
  assert.equal(planner.parseBackup(backupText(planner, source)).ok, false);
});

test('A06 normalization drops tasks with invalid explicit dates', () => {
  const planner = loadPlanner();
  const normalized = planner.normalizeState({ tasks: [
    { id: 'valid', title: '有效日期', duration: 30, date: '2026-09-25' },
    { id: 'invalid', title: '无效日期', duration: 30, date: '2026-02-30' }
  ] });
  assert.deepEqual(normalized.tasks.map(task => task.id), ['valid']);
});

test('A07 completed status is excluded from scheduling', () => {
  const planner = loadPlanner();
  const normalized = planner.normalizeState({ tasks: [{ id: 'done', title: '已完成', duration: 30, status: 'completed', completed: false }] });
  const schedule = planner.planForDate(normalized, '2026-09-25', '2026-09-25T07:00:00');
  assert.equal(schedule.blocks.some(block => block.id === 'done'), false);
});

test('A08 backup import rejects equal or malformed routine times', () => {
  const planner = loadPlanner();
  for (const settings of [
    { wake: '07:00', sleep: '07:00' },
    { wake: '7:00', sleep: '22:30' }
  ]) {
    const invalid = validBackup({ settings: { ...validBackup().settings, ...settings } });
    assert.equal(planner.parseBackup('TimeSprout backup v2\n' + JSON.stringify(invalid)).ok, false);
  }
});

test('A09 inherited object names remain ordinary text in English translation', () => {
  const planner = loadPlanner();
  assert.equal(planner.translate('constructor', 'en'), 'constructor');
  assert.equal(planner.translate('__proto__', 'en'), '__proto__');
});

test('A11 imported running focus is paused without counting elapsed time', () => {
  const planner = loadPlanner();
  const runningFocus = {
    taskId: 'task-1', mode: 'focus', running: true, remainingSeconds: 1400,
    startedAt: '2026-09-24T10:00:00', completedPomodoros: 0, totalSeconds: 100, lastTick: 1
  };
  const parsed = planner.parseBackup(backupText(planner, validBackup({ focus: {
    ...runningFocus
  }, undo: { reason: 'previous state', state: validBackup({ focus: runningFocus }) } })));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.focus.running, false);
  assert.equal(parsed.state.focus.lastTick, 0);
  assert.equal(parsed.state.focus.startedAt, '');
  assert.equal(parsed.state.focus.remainingSeconds, 1400);
  assert.equal(parsed.state.focus.totalSeconds, 100);
  assert.equal(parsed.state.undo.state.focus.running, false);
  assert.equal(parsed.state.undo.state.focus.lastTick, 0);
});
