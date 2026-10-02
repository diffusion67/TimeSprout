const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appHtmlPath = path.join(__dirname, 'index.html');

function loadBackupUi() {
  const html = fs.readFileSync(appHtmlPath, 'utf8').replace(/\r\n/g, '\n');
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  script = script.replace(
    'function showBackupNotice(key){notice=message(key,{},activeLanguage());renderApp()}',
    'function showBackupNotice(key){globalThis.__backupNotices.push(key)}'
  );
  script = script.replace('function renderApp(){', 'function renderApp(){globalThis.__backupRenders=(globalThis.__backupRenders||0)+1;return;');
  script = script.replace(
    /function stageBackupFile\(file\)\{[\s\S]*?\}\n  function dangerConfirmationPanel/,
    match => match.slice(0, match.lastIndexOf('\n  function dangerConfirmationPanel')) +
      '\n  globalThis.__auditBackup={stageBackupFile,getPending:()=>pendingBackupImport,getConfirmation:()=>pendingDangerConfirmation,setConfirmation:value=>pendingDangerConfirmation=value};' +
      '\n  return;\n  function dangerConfirmationPanel'
  );
  global.localStorage = { getItem: () => null, setItem() {} };
  global.document = { documentElement: { dataset: {} }, addEventListener() {} };
  global.__backupNotices = [];
  global.__backupRenders = 0;
  global.__auditBackup = undefined;
  eval(script);
  return global.__auditBackup;
}

function backupText(tasks) {
  const planner = global.AgendaPlanner;
  return planner.serializeBackup(planner.normalizeState({ tasks }));
}

test('N05 choosing another backup clears the staged backup and confirmation immediately', () => {
  const readers = [];
  global.FileReader = class {
    constructor() { readers.push(this); }
    readAsText(file) { this.file = file; }
  };
  const ui = loadBackupUi();
  ui.stageBackupFile({ name: 'a.txt', size: 10 });
  readers[0].result = backupText([{ id: 'from-a', title: 'A', duration: 30 }]);
  readers[0].onload();
  assert.equal(ui.getPending().tasks[0].id, 'from-a');
  ui.setConfirmation({ action: 'import-replace', stage: 1 });

  const rendersBeforeSecondSelection = global.__backupRenders;
  ui.stageBackupFile({ name: 'b.txt', size: 10 });
  assert.equal(ui.getPending(), null);
  assert.equal(ui.getConfirmation(), null);
  assert.equal(global.__backupRenders, rendersBeforeSecondSelection + 1);

  readers[0].result = backupText([{ id: 'late-a', title: 'Late A', duration: 30 }]);
  readers[0].onload();
  assert.equal(ui.getPending(), null);

  readers[1].result = backupText([{ id: 'from-b', title: 'B', duration: 30 }]);
  readers[1].onload();
  readers[0].onload();
  assert.equal(ui.getPending().tasks[0].id, 'from-b');
  delete global.FileReader;
  delete global.document;
});

test('N12 weekly course overlap checks use the next local midnight on DST rollback day', () => {
  const code = `const fs=require('fs');const s=fs.readFileSync('index.html','utf8').match(/<script>([\\s\\S]*?)<\\/script>/)[1];global.localStorage={getItem:()=>null,setItem:()=>{}};eval(s);const conflicts=global.AgendaPlanner.findScheduleConflicts([{id:'course',day:0,start:'23:35',end:'23:50'}],[{id:'event',start:'2026-11-01T23:30:00',end:'2026-11-01T23:45:00'}]);process.stdout.write(JSON.stringify(conflicts));`;
  const result = execFileSync(process.execPath, ['-e', code], {
    cwd: __dirname,
    env: { ...process.env, TZ: 'America/New_York' },
    encoding: 'utf8'
  });
  assert.deepEqual(JSON.parse(result).map(pair => [pair.firstId, pair.secondId].sort()), [['course', 'event']]);
});

test('N05 backup picker redraw can restore settings controls after the file input', () => {
  const ui = loadBackupUi();
  assert.ok(ui);
  const controls = [
    { name: 'wake', type: 'time', value: '08:15' },
    { name: 'backup', type: 'file', value: '' },
    { name: 'sleep', type: 'time', value: '23:15' }
  ];
  const captured = global.AgendaPlanner.captureFormState({ querySelectorAll: () => controls });
  const restored = controls.map(control => ({ ...control, value: '' }));
  global.AgendaPlanner.restoreFormState({ querySelectorAll: () => restored }, captured);
  assert.equal(restored[0].value, '08:15');
  assert.equal(restored[2].value, '23:15');
});
