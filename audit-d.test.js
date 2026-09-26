const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const htmlPath = path.join(__dirname, 'index.html');

function loadPlanner() {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  global.localStorage = { getItem: () => null, setItem: () => {} };
  delete global.document;
  delete global.AgendaPlanner;
  eval(script);
  return global.AgendaPlanner;
}

test('D01 changing a setting invalidates a schedule undo snapshot', () => {
  const planner = loadPlanner();
  const state = { settings: { theme: 'light' }, undo: { reason: 'reschedule' } };
  assert.equal(planner.clearUndo(state).undo, null);
});

test('D02 detects when the active planning date has advanced', () => {
  const planner = loadPlanner();
  assert.equal(planner.didPlanningDateChange('2026-09-24', '2026-09-25T00:01:00', '07:00', '22:30'), true);
  assert.equal(planner.didPlanningDateChange('2026-09-24', '2026-09-24T23:59:00', '07:00', '22:30'), false);
});

test('D03 can restore keyboard focus to the matching control after a render', () => {
  const planner = loadPlanner();
  let focused = false;
  const target = { dataset: { command: 'focus-toggle' }, focus: options => { focused = options.preventScroll } };
  const root = { querySelectorAll: () => [target] };
  assert.equal(planner.restoreRenderedFocus(root, { dataset: { command: 'focus-toggle' } }), true);
  assert.equal(focused, true);
});

test('D04 focus controls describe the action for the current mode', () => {
  const planner = loadPlanner();
  assert.deepEqual(planner.focusControlLabels({ mode: 'break', running: false }), { toggle: '开始休息', skip: '切回专注' });
  assert.deepEqual(planner.focusControlLabels({ mode: 'break', running: true }), { toggle: '暂停', skip: '切回专注' });
  assert.equal(planner.translate(planner.focusControlLabels({ mode: 'break', running: false }).toggle, 'en'), 'Start break');
  assert.equal(planner.translate(planner.focusControlLabels({ mode: 'break', running: false }).skip, 'en'), 'Switch to focus');
});

test('D05 focus pause/resume retains the associated task after it leaves the pending list', () => {
  const planner = loadPlanner();
  assert.equal(planner.focusTaskForToggle({ taskId: 'completed-task' }, 'next-pending-task'), 'completed-task');
  assert.equal(planner.canStartFocus({ taskId: 'completed-task', startedAt: '' }, { id: 'completed-task', status: 'completed', completed: true }, 'completed-task'), false);
  assert.equal(planner.canStartFocus({ taskId: 'completed-task', startedAt: '2030-01-01T10:00:00' }, { id: 'completed-task', status: 'completed', completed: true }, 'completed-task'), true);
});

test('D06 restoring routine defaults preserves appearance, navigation, and focus records', () => {
  const planner = loadPlanner();
  const restored = planner.resetSettingsState({
    settings: { wake: '09:00', sleep: '23:00', play: 30, theme: 'dark', language: 'en', navigationLayout: 'sidebar' },
    focus: { taskId: '', mode: 'break', running: false, remainingSeconds: 120, completedPomodoros: 4, totalSeconds: 6000 },
    analytics: { daily: {} }, undo: { reason: 'adjust' }
  });
  assert.deepEqual(restored.settings, { wake: '07:00', sleep: '22:30', play: 60, theme: 'dark', language: 'en', navigationLayout: 'sidebar' });
  assert.equal(restored.focus.totalSeconds, 6000);
  assert.equal(restored.focus.completedPomodoros, 4);
  assert.equal(restored.undo, null);
});

test('D07 the second dangerous action only advances from the warning panel', () => {
  const planner = loadPlanner();
  const first = planner.advanceDangerConfirmation(null, 'clear-plan');
  assert.deepEqual(first, { action: 'clear-plan', stage: 1 });
  assert.deepEqual(planner.advanceDangerConfirmation(first, 'clear-plan'), first);
  assert.deepEqual(planner.advanceDangerConfirmation(first, 'clear-plan', true), { action: 'clear-plan', stage: 2 });
});

test('D09 language redraw can restore unsaved form values', () => {
  const planner = loadPlanner();
  const before = [
    { name: 'title', type: 'text', value: 'unfinished title', checked: false },
    { name: 'urgent', type: 'checkbox', value: 'on', checked: true }
  ];
  const snapshot = planner.captureFormState({ querySelectorAll: () => before });
  const after = [
    { name: 'title', type: 'text', value: 'old saved title', checked: false },
    { name: 'urgent', type: 'checkbox', value: 'on', checked: false }
  ];
  planner.restoreFormState({ querySelectorAll: () => after }, snapshot);
  assert.equal(after[0].value, 'unfinished title');
  assert.equal(after[1].checked, true);
});

test('D10 mobile more menu has a viewport-bounded scroll area', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /\.mobileMore\{[^}]*max-height:calc\(100dvh - 100px - env\(safe-area-inset-bottom\)\);overflow-y:auto/s);
});

test('D11 focus ticks carry fractional elapsed time forward', () => {
  const planner = loadPlanner();
  const current = { focus: { running: true, mode: 'focus', remainingSeconds: 1500, lastTick: 1000 }, undo: { reason: 'adjust' } };
  const first = planner.tickFocusState(current, 2500).state;
  assert.equal(first.focus.remainingSeconds, 1499);
  assert.equal(first.focus.lastTick, 2000);
  const second = planner.tickFocusState(first, 4000).state;
  assert.equal(second.focus.remainingSeconds, 1497);
  assert.equal(second.focus.lastTick, 4000);
});

test('D12 running focus ticks retain an available undo record', () => {
  const planner = loadPlanner();
  const undo = { reason: 'reschedule', state: { tasks: [] } };
  const result = planner.tickFocusState({ focus: { running: true, mode: 'focus', remainingSeconds: 120, lastTick: 1000 }, undo }, 2000);
  assert.equal(result.state.undo, undo);
  assert.equal(result.state.focus.remainingSeconds, 119);
});

test('D08 partial focus time accumulates in session totals and daily analytics', () => {
  const planner = loadPlanner();
  const start = Date.parse('2030-01-02T10:00:00');
  const source = planner.normalizeState({
    settings: { wake: '07:00', sleep: '22:30' },
    focus: { running: true, mode: 'focus', remainingSeconds: 1500, lastTick: start }
  });
  const partial = planner.tickFocusState(source, start + 37_000).state;
  const repeated = planner.tickFocusState(partial, start + 37_000).state;
  assert.equal(partial.focus.totalSeconds, 37);
  assert.equal(partial.focus.remainingSeconds, 1463);
  assert.equal(partial.analytics.daily['2030-01-02'].focusSeconds, 37);
  assert.equal(repeated.focus.totalSeconds, 37);
  assert.equal(repeated.analytics.daily['2030-01-02'].focusSeconds, 37);
});

test('D08 completing a 25-minute focus round records 1500 seconds once', () => {
  const planner = loadPlanner();
  const start = Date.parse('2030-01-02T10:00:00');
  const source = planner.normalizeState({
    settings: { wake: '07:00', sleep: '22:30' },
    focus: { running: true, mode: 'focus', remainingSeconds: 1500, lastTick: start }
  });
  const completed = planner.tickFocusState(source, start + 1_500_000).state;
  const persisted = planner.normalizeState(JSON.parse(JSON.stringify(completed)));
  const repeated = planner.tickFocusState(persisted, start + 1_500_000).state;
  assert.equal(completed.focus.completedPomodoros, 1);
  assert.equal(completed.focus.totalSeconds, 1500);
  assert.equal(completed.analytics.daily['2030-01-02'].focusSeconds, 1500);
  assert.equal(repeated.focus.totalSeconds, 1500);
  assert.equal(repeated.analytics.daily['2030-01-02'].focusSeconds, 1500);
});

test('D08 resetting a partial session keeps its elapsed time and analytics', () => {
  const planner = loadPlanner();
  const start = Date.parse('2030-01-02T10:00:00');
  const source = planner.normalizeState({
    settings: { wake: '07:00', sleep: '22:30' },
    focus: { running: true, mode: 'focus', remainingSeconds: 1500, lastTick: start }
  });
  const reset = planner.resetFocusState(source, '', start + 42_000);
  assert.equal(reset.focus.running, false);
  assert.equal(reset.focus.remainingSeconds, 1500);
  assert.equal(reset.focus.totalSeconds, 42);
  assert.equal(reset.analytics.daily['2030-01-02'].focusSeconds, 42);
});

test('D08 focus seconds on either side of an overnight planning boundary go to their own dates', () => {
  const planner = loadPlanner();
  const start = Date.parse('2030-01-02T05:59:58');
  const source = planner.normalizeState({
    settings: { wake: '20:00', sleep: '06:00' },
    focus: { running: true, mode: 'focus', remainingSeconds: 20, lastTick: start }
  });
  const result = planner.tickFocusState(source, start + 4_000).state;
  assert.equal(result.analytics.daily['2030-01-01'].focusSeconds, 2);
  assert.equal(result.analytics.daily['2030-01-02'].focusSeconds, 2);
  assert.equal(result.focus.totalSeconds, 4);
});
