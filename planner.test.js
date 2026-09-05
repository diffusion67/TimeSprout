const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appHtmlPath = path.join(__dirname, 'index.html');

function loadPlanner(saved) {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  global.localStorage = { getItem: () => JSON.stringify(saved || { settings: { language: 'en' } }), setItem: () => {} };
  delete global.document;
  delete global.AgendaPlanner;
  eval(script);
  return global.AgendaPlanner;
}

function loadPlannerWithStorageKey(saved) {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(
    "  if(typeof document==='undefined')return;",
    "  globalThis.__loadedStateForTest=state;if(typeof document==='undefined')return;"
  );
  let requestedKey;
  global.localStorage = {
    getItem(key) { requestedKey = key; return JSON.stringify(saved); },
    setItem: () => {}
  };
  delete global.document;
  delete global.AgendaPlanner;
  delete global.__loadedStateForTest;
  eval(script);
  return { planner: global.AgendaPlanner, requestedKey, loadedState: global.__loadedStateForTest };
}

function renderedDefaultText() {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const listeners = [];
  const app = { innerHTML: '' };
  global.localStorage = { getItem: () => JSON.stringify({ settings: { language: 'en' } }), setItem: () => {} };
  global.NodeFilter = { SHOW_TEXT: 4 };
  global.document = {
    documentElement: {}, activeElement: null, querySelector: () => app, querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => null }),
    addEventListener: (type, handler, capture = false) => listeners.push({ type, handler, capture })
  };
  global.setInterval = () => 0;
  delete global.AgendaPlanner;
  eval(script);
  const text = [];
  for (const tab of ['today', 'calendar', 'quadrants', 'focus', 'analytics', 'courses', 'holiday', 'guide', 'settings']) {
    const button = { dataset: { tab }, closest: () => button };
    const event = { target: button, stopImmediatePropagation() {} };
    for (const listener of listeners.filter(item => item.type === 'click' && item.capture)) listener.handler(event);
    for (const listener of listeners.filter(item => item.type === 'click' && !item.capture)) listener.handler(event);
    for (const match of app.innerHTML.matchAll(/>([^<>]+)</g)) text.push(match[1].trim());
  }
  return text.filter(Boolean).map(value => global.AgendaPlanner.translate(value, 'en'));
}

function renderedTitle(language) {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const app = { innerHTML: '' };
  const document = {
    title: '', documentElement: {}, activeElement: null, querySelector: () => app, querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => null }), addEventListener: () => {}
  };
  global.localStorage = { getItem: () => JSON.stringify({ settings: { language } }), setItem: () => {} };
  global.NodeFilter = { SHOW_TEXT: 4 };
  global.document = document;
  global.setInterval = () => 0;
  delete global.AgendaPlanner;
  eval(script);
  return document.title;
}

function localDateTime(value) {
  const pad = part => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function interactionHarness(saved) {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const listeners = [];
  const intervals = new Map();
  let markup = '';
  let pieces = null;
  let advanced = null;
  let renderCount = 0;
  let liveUpdateCount = 0;
  const liveNodes = new Map();
  const savedWrites = [];

  function parseTextNodes() {
    const nextPieces = [];
    const nodes = [];
    const stack = [];
    const token = /<[^>]*>|[^<]+/g;
    for (const value of markup.match(token) || []) {
      if (value.startsWith('<')) {
        nextPieces.push({ value });
        const closing = /^<\//.test(value);
        const tag = value.match(/^<\/?\s*([\w-]+)/)?.[1];
        if (closing) stack.pop();
        else if (tag && !/\/$/.test(value) && !['input', 'br', 'img', 'meta', 'link'].includes(tag.toLowerCase())) stack.push(value);
        continue;
      }
      const piece = { value, ancestors: stack.join(' ') };
      nextPieces.push(piece);
      nodes.push({
        get nodeValue() { return piece.value; },
        set nodeValue(next) { piece.value = String(next); },
        parentElement: {
          closest(selector) {
            return selector.split(',').some(part => {
              const attribute = part.match(/\[([^\]]+)\]/)?.[1];
              return attribute && piece.ancestors.includes(attribute);
            }) ? {} : null;
          }
        }
      });
    }
    pieces = nextPieces;
    return nodes;
  }

  const app = {
    get innerHTML() {
      return pieces ? pieces.map(piece => piece.value).join('') : markup;
    },
    set innerHTML(value) {
      markup = String(value);
      pieces = null;
      renderCount++;
      advanced = /<details class="advanced"/.test(markup) ? { open: false } : null;
      liveNodes.clear();
      for (const key of ['clock', 'currentTitle', 'currentTime', 'nextTitle', 'nextTime', 'pending', 'overdue']) {
        if (new RegExp(`data-live-${key}`).test(markup)) {
          liveNodes.set(key, {
            textContent: '',
            setText(value) { this.textContent = String(value); liveUpdateCount++; }
          });
        }
      }
    },
    querySelector(selector) {
      const match = selector.match(/^\[data-live-(.+)\]$/);
      if (!match) return null;
      const node = liveNodes.get(match[1]);
      if (!node) return null;
      return {
        get textContent() { return node.textContent; },
        set textContent(value) { node.setText(value); }
      };
    }
  };

  global.localStorage = { getItem: () => JSON.stringify(saved), setItem: (key, value) => savedWrites.push({ key, value }) };
  global.FileReader = class {
    readAsText(file) {
      this.result = file.text;
      this.onload?.({ target: this });
    }
  };
  global.NodeFilter = { SHOW_TEXT: 4 };
  const root = { dataset: {} };
  global.document = {
    title: '', documentElement: root, activeElement: null,
    querySelector: selector => selector === '#app' ? app : null,
    querySelectorAll: () => [],
    createTreeWalker: () => {
      const nodes = parseTextNodes();
      let index = 0;
      return { nextNode: () => nodes[index++] || null };
    },
    addEventListener: (type, handler, capture = false) => listeners.push({ type, handler, capture })
  };
  global.setInterval = (callback, delay) => { intervals.set(delay, callback); return delay; };
  delete global.AgendaPlanner;
  eval(script);

  function dispatch(type, target) {
    const event = {
      target, defaultPrevented: false, immediatePropagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.immediatePropagationStopped = true; }
    };
    for (const listener of listeners.filter(item => item.type === type && item.capture)) {
      listener.handler(event);
      if (event.immediatePropagationStopped) return event;
    }
    for (const listener of listeners.filter(item => item.type === type && !item.capture)) {
      listener.handler(event);
      if (event.immediatePropagationStopped) return event;
    }
    return event;
  }

  return {
    app,
    get markup() { return app.innerHTML; },
    get renderCount() { return renderCount; },
    get liveUpdateCount() { return liveUpdateCount; },
    get advanced() { return advanced; },
    get savedWrites() { return savedWrites; },
    root,
    changeLanguage(value) { dispatch('change', { value, matches: selector => selector === '[data-language]' }); },
    changeTheme(value) { dispatch('change', { value, matches: selector => selector === '[name="theme"]' }); },
    changeBackupFile(file) { dispatch('change', { files: [file], matches: selector => selector === '[data-backup-import]' }); },
    pressCommand(command) { const button = { dataset: { command }, closest: () => button }; dispatch('click', button); },
    pressTaskAction(id, action) { const button = { dataset: { id, act: action }, closest: () => button }; dispatch('click', button); },
    submitForm(type, values) {
      const OriginalFormData = global.FormData;
      global.FormData = class { constructor() {} get(name) { return values[name] ?? null; } };
      const event = dispatch('submit', { dataset: { form: type } });
      global.FormData = OriginalFormData;
      return event;
    },
    selectTab(tab) { const button = { dataset: { tab }, closest: () => button }; dispatch('click', button); },
    clickAnalyticsRange(days) { const button = { dataset: { analyticsRange: String(days) }, closest: () => button }; dispatch('click', button); },
    changeAnalyticsDate(value) { dispatch('change', { value, matches: selector => selector === '[data-analytics-date]' }); },
    runQuietReminderPoll() { intervals.get(30000)(); }
  };
}

function initialAndQuietLiveTitle(saved, result, now) {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let markup = '';
  let titleNode = null;
  const app = {
    get innerHTML() {
      return markup;
    },
    set innerHTML(value) {
      markup = String(value);
      const match = markup.match(/<b([^>]*)data-live-currentTitle([^>]*)>([^<]*)<\/b>/);
      const localized = Boolean(match && /\bdata-localized\b/.test(`${match[1]}${match[2]}`));
      const liveTitle = Boolean(match);
      let text = match?.[3] || '';
      titleNode = {
        get nodeValue() { return text; },
        set nodeValue(value) { text = String(value); },
        get textContent() { return text; },
        set textContent(value) { text = String(value); },
        parentElement: { closest: selector => (selector === '[data-user-field],[data-localized]' && localized) || (selector.includes('[data-live-currentTitle]') && liveTitle) ? {} : null }
      };
    },
    querySelector: selector => selector === '[data-live-currentTitle]' ? titleNode : null
  };
  global.localStorage = { getItem: () => JSON.stringify(saved), setItem: () => {} };
  global.NodeFilter = { SHOW_TEXT: 4 };
  global.document = {
    title: '', documentElement: {}, activeElement: null, querySelector: selector => selector === '#app' ? app : null,
    querySelectorAll: () => [],
    createTreeWalker: () => {
      let visited = false;
      return { nextNode: () => visited || !titleNode ? null : (visited = true, titleNode) };
    },
    addEventListener: () => {}
  };
  global.setInterval = () => 0;
  delete global.AgendaPlanner;
  eval(script);
  const initial = titleNode.textContent;
  global.AgendaPlanner.updateLiveDashboard(app, global.AgendaPlanner.buildLiveDashboardValues(result, now));
  return { initial, quiet: titleNode.textContent };
}

function localizedStatusTextWithMatchingTaskTitle(title, statusText = '起床与晨间准备') {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const app = { innerHTML: '' };
  const statusNode = { nodeValue: statusText, parentElement: { tagName: 'B', closest: selector => selector === '.status' ? {} : null } };
  let visited = false;
  global.localStorage = { getItem: () => JSON.stringify({ settings: { language: 'en' }, tasks: [{ id: 'task-1', title, duration: 30, due: '2030-01-01T12:00:00' }] }), setItem: () => {} };
  global.NodeFilter = { SHOW_TEXT: 4 };
  global.document = {
    title: '', documentElement: {}, activeElement: null, querySelector: () => app, querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => visited ? null : (visited = true, statusNode) }), addEventListener: () => {}
  };
  global.setInterval = () => 0;
  delete global.AgendaPlanner;
  eval(script);
  return statusNode.nodeValue;
}

test('calendar shows an event on every date it overlaps and omits skipped tasks', () => {
  const planner = loadPlanner();
  const state = {
    courses: [],
    tasks: [{ id: 'task-1', title: 'Skipped task', due: '2026-08-27T12:00:00', status: 'skipped' }],
    events: [{ id: 'event-1', title: 'Overnight event', start: '2026-08-26T23:00:00', end: '2026-08-27T01:00:00' }]
  };

  assert.deepEqual(planner.entriesForDate(state, '2026-08-26'), [{ title: 'Overnight event', type: 'event' }]);
  assert.deepEqual(planner.entriesForDate(state, '2026-08-27'), [{ title: 'Overnight event', type: 'event' }]);
  assert.deepEqual(planner.entriesForDate(state, '2026-08-28'), []);
});

test('a direct state change invalidates a previous undo snapshot without losing current data', () => {
  const planner = loadPlanner();
  const current = { courses: [{ id: 'course-1', title: 'Math' }], undo: { reason: 'Add task', state: {} } };

  assert.deepEqual(planner.clearUndo(current), { courses: [{ id: 'course-1', title: 'Math' }], undo: null });
});

test('English translation covers the fixed-conflict alert fragments', () => {
  const planner = loadPlanner();

  assert.equal(planner.translate('发现 2 处固定事项冲突。', 'en'), 'Found 2 fixed-schedule conflicts.');
  assert.equal(planner.translate('课程、临时事项或正在打卡的任务发生重叠，请调整其中一项。', 'en'), 'Courses, events, or active tasks overlap. Adjust one of them.');
  assert.equal(planner.translate('已自动重排：添加任务；发现 2 处固定事项冲突', 'en'), 'Rescheduled: Add task; Found 2 fixed-schedule conflicts');
  assert.equal(planner.translate('已自动重排：加入固定事项；发现 2 处固定事项冲突', 'en'), 'Rescheduled: Add fixed event; Found 2 fixed-schedule conflicts');
});

test('a focus timer tick invalidates a prior undo snapshot while preserving focus progress', () => {
  const planner = loadPlanner();
  const result = planner.tickFocusState({
    focus: { running: true, mode: 'focus', remainingSeconds: 1500, lastTick: 1000 },
    undo: { reason: 'Add task', state: {} }
  }, 6000);

  assert.equal(result.state.undo, null);
  assert.equal(result.state.focus.remainingSeconds, 1495);
  assert.equal(result.state.focus.lastTick, 6000);
});

test('English mode leaves no Chinese in built-in runtime messages', () => {
  const planner = loadPlanner();
  const messages = [
    '完成一个番茄，休息 5 分钟吧。', '休息结束，准备下一轮专注。', '起床与晨间准备', '睡前整理与休息',
    '今日玩乐时间', '课程', '单次休息', '临时事件', '锁定安排', '作息', '玩乐', '专注任务',
    '今天还是一张白纸。添加一个任务，让计划从第一步开始。', '高优先级', '低优先级', '完成后休息',
    '不休息', '结束并完成', '延后', '跳过', '例如：完成数学练习册', '例如：临时班会 / 就医',
    '课程、截止任务和临时事项都会显示在对应日期。', '事项', '重要且紧急', '重要不紧急', '不重要但紧急',
    '不重要不紧急', '专注时间', '休息时间', '正在为「Task」专注', '已撤销重排', '先选择一个待办任务再开始专注',
    '结束时间必须晚于开始时间。', '课程结束时间必须晚于开始时间。', '截止时间格式不正确。', '起床和睡觉时间不能相同。',
    '请输入正确的起床和睡觉时间。', '课程已加入每周课表', '作息设置已保存，今日已按新节奏重新计算。', '任务已逾期：Task', '假期学习：'
  ];

  const untranslated = messages.filter(message => /[\u3400-\u9fff]/.test(planner.translate(message, 'en')));
  assert.deepEqual(untranslated, []);
});

test('English mode renders no Chinese in the default app interface', () => {
  const untranslated = renderedDefaultText().filter(value => /[\u3400-\u9fff]/.test(value));

  assert.deepEqual(untranslated, []);
});

test('analytics view renders summary cards, a 30-day control, and an allocation legend', () => {
  const harness = interactionHarness({
    settings: { language: 'zh-CN', play: 60 },
    analytics: { daily: { '2030-01-01': { completedTaskCount: 1, completedTaskMinutes: 30, focusSeconds: 1500 } } },
    events: [{ id: 'event-1', title: '预约', start: '2030-01-02T08:00:00', end: '2030-01-02T09:00:00' }],
    tasks: [{ id: 'task-1', title: '写作', duration: 30, due: '2030-01-02T12:00:00', status: 'pending' }]
  });

  harness.selectTab('analytics');
  const writesBeforeViewChanges = harness.savedWrites.length;
  harness.clickAnalyticsRange(30);
  harness.changeAnalyticsDate('2030-01-02');

  assert.match(harness.markup, /完成率/);
  assert.match(harness.markup, /专注时长/);
  assert.match(harness.markup, /近 30 天/);
  assert.match(harness.markup, /今日时间分配/);
  assert.match(harness.markup, /class="allocationLegend events"/);
  assert.match(harness.markup, /value="2030-01-02"/);
  assert.equal(harness.savedWrites.length, writesBeforeViewChanges);
});

test('analytics allocation keeps all four categories visible when a plan uses only one category', () => {
  const harness = interactionHarness({
    settings: { language: 'zh-CN', play: 0 },
    events: [{ id: 'event-1', title: '预约', start: '2030-01-02T08:00:00', end: '2030-01-02T09:00:00' }]
  });

  harness.selectTab('analytics');
  harness.changeAnalyticsDate('2030-01-02');

  assert.match(harness.markup, /课程 0 分钟/);
  assert.match(harness.markup, /事项 60 分钟/);
  assert.match(harness.markup, /任务 0 分钟/);
  assert.match(harness.markup, /玩乐 0 分钟/);
});

test('analytics keeps thirty-day trend columns in a narrow-screen scroll container', () => {
  const harness = interactionHarness({ settings: { language: 'zh-CN', play: 0 } });

  harness.selectTab('analytics');
  harness.clickAnalyticsRange(30);

  assert.match(harness.markup, /class="analyticsTrendScroll"/);
  assert.equal((harness.markup.match(/class="trendBar tasks"/g) || []).length, 30);
  assert.match(fs.readFileSync(appHtmlPath, 'utf8'), /\.analyticsTrendScroll\{[^}]*overflow-x:auto/);
});

test('English analytics chart labels and category aria-labels contain no Chinese', () => {
  const harness = interactionHarness({
    settings: { language: 'en', play: 0 },
    events: [{ id: 'event-1', title: 'Appointment', start: '2030-01-02T08:00:00', end: '2030-01-02T09:00:00' }]
  });

  harness.selectTab('analytics');
  harness.changeAnalyticsDate('2030-01-02');

  const ariaLabels = [...harness.markup.matchAll(/aria-label="([^"]*)"/g)].map(match => match[1]);
  assert.ok(ariaLabels.length > 0);
  assert.deepEqual(ariaLabels.filter(label => /[\u3400-\u9fff]/.test(label)), []);
  assert.match(harness.markup, /aria-label="Event 60 min"/);
});

test('analytics view explains how to create the first data point', () => {
  const harness = interactionHarness({ settings: { language: 'zh-CN', play: 0 } });

  harness.selectTab('analytics');

  assert.match(harness.markup, /开始完成任务或进行专注后/);
  assert.match(harness.markup, /这一天还没有可分析的计划。/);
});

test('analytics completion metric names an empty Chinese non-leisure task cohort', () => {
  const harness = interactionHarness({
    settings: { language: 'zh-CN', play: 0 },
    tasks: [{ id: 'leisure', title: '休息', duration: 30, due: '2030-01-02T12:00:00', leisure: true, status: 'pending' }]
  });

  harness.selectTab('analytics');

  assert.match(harness.markup, /<span>完成率<\/span><b>暂无任务<\/b>/);
  assert.doesNotMatch(harness.markup, /<span>完成率<\/span><b>—<\/b><small>0 \/ 0 项<\/small>/);
});

test('analytics completion metric names an empty English non-leisure task cohort', () => {
  const harness = interactionHarness({
    settings: { language: 'en', play: 0 },
    tasks: [{ id: 'leisure', title: 'Leisure', duration: 30, due: '2030-01-02T12:00:00', leisure: true, status: 'pending' }]
  });

  harness.selectTab('analytics');

  assert.match(harness.markup, /<span>Completion rate<\/span><b>No tasks yet<\/b>/);
  assert.doesNotMatch(harness.markup, /<span>Completion rate<\/span><b>—<\/b><small>0 \/ 0 items<\/small>/);
});

test('English dynamic notices translate their templates without changing user-provided text', () => {
  const planner = loadPlanner();
  const messages = [
    '有 3 个任务已超时。', '可以立即重新排入空闲时间。', '暂时排不下：Task。可延后、缩短时长或调整作息。',
    '已安排：10:00 — 10:45，Task', '已添加 Task，暂时没有足够空闲时间', '撤销记录已失效，已安全清除。',
    '现在该做：Task', '10:00 即将开始：Task', '任务完成后休息 · 5 分钟', '2026-08-26 至 2026-08-27 · 每天 90 分钟'
  ];

  assert.equal(planner.translate('已安排：添加任务', 'en', ['添加任务']), 'Scheduled: 添加任务');
  assert.equal(planner.translate('暂无待办任务', 'en', ['任务']), 'No pending tasks');
  assert.equal(planner.translate('添加任务', 'en', ['添加任务'], true), '添加任务');
  assert.deepEqual(messages.filter(message => /[\u3400-\u9fff]/.test(planner.translate(message, 'en', ['Task']))), []);
});

test('keyed messages keep explicitly marked user fields unchanged', () => {
  const planner = loadPlanner();

  assert.equal(
    planner.message('reminder.startsSoon', { time: '09:00', title: planner.userField('课程') }, 'en'),
    '09:00 starts soon: 课程'
  );
});

test('public keyed localization APIs render keys and explicit markers', () => {
  const planner = loadPlanner();

  assert.equal(planner.t('status.current', 'en'), 'Now');
  assert.equal(planner.translateMarked('09:00 即将开始：\uE100课程\uE101', 'en'), '09:00 starts soon: 课程');
});

test('user task titles cannot change unrelated static English labels', () => {
  const planner = loadPlanner({
    settings: { language: 'en' },
    tasks: [
      { id: 'task-1', title: '任务', duration: 30, due: '2030-01-01T12:00:00' },
      { id: 'task-2', title: '课程', duration: 30, due: '2030-01-01T12:00:00' }
    ]
  });

  assert.equal(planner.message('status.current', {}, 'en'), 'Now');
  assert.equal(planner.message('status.pending', {}, 'en'), 'To do');
});

test('saving routine settings preserves the selected language', () => {
  const planner = loadPlanner();
  const result = planner.updateSettingsState(
    { settings: { wake: '07:00', sleep: '22:30', play: 60, language: 'en' } },
    { wake: '06:30', sleep: '22:00', play: 30 }
  );

  assert.deepEqual(result.settings, { wake: '06:30', sleep: '22:00', play: 30, language: 'en', theme: 'system', navigationLayout: 'top' });
});

test('theme resolution accepts saved choices and falls back to the system preference', () => {
  const planner = loadPlanner();

  assert.equal(planner.normalizeTheme('dark'), 'dark');
  assert.equal(planner.normalizeTheme('unknown'), 'system');
  assert.equal(planner.resolveTheme('system', true), 'dark');
  assert.equal(planner.resolveTheme('system', false), 'light');
});

test('navigation layout normalizes, persists, and defaults legacy plans to top navigation', () => {
  const planner = loadPlanner();

  assert.equal(planner.normalizeNavigationLayout('sidebar'), 'sidebar');
  assert.equal(planner.normalizeNavigationLayout('unknown'), 'top');
  assert.equal(planner.normalizeState({ settings: { navigationLayout: 'sidebar' } }).settings.navigationLayout, 'sidebar');
  assert.equal(planner.normalizeState({ settings: { theme: 'dark' } }).settings.navigationLayout, 'top');
  assert.equal(planner.updateSettingsState(planner.normalizeState({}), { wake: '07:00', sleep: '22:30', play: 60, theme: 'system', navigationLayout: 'sidebar' }).settings.navigationLayout, 'sidebar');
});

test('applying a theme sets one resolved root attribute', () => {
  const planner = loadPlanner();
  const root = { dataset: {} };

  planner.applyTheme('dark', root, false);

  assert.equal(root.dataset.theme, 'dark');
});

test('theme stylesheet keeps the language picker on semantic control colors', () => {
  const html = fs.readFileSync(appHtmlPath, 'utf8');

  assert.match(html, /\.language select\{background:var\(--surface-soft\);color:var\(--text\);border:1px solid var\(--border\)\}/);
});

test('theme stylesheet confines every color literal to the designated theme-token declarations', () => {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const styles = [...html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
  const tokenStyles = styles.filter(([, attributes]) => /\bdata-theme-tokens\b/.test(attributes));
  const nonTokenStyles = styles
    .filter(([, attributes]) => !/\bdata-theme-tokens\b/.test(attributes))
    .map(([, , css]) => css)
    .join('\n');
  const inlineStyles = [...html.matchAll(/\sstyle=(?:"([^"]*)"|'([^']*)')/g)]
    .map(([, doubleQuoted, singleQuoted]) => doubleQuoted || singleQuoted || '')
    .join('\n');

  assert.equal(tokenStyles.length, 1);
  assert.match(tokenStyles[0][2], /:root\{(?:--[\w-]+:[^;{}]+;)+\}/);
  assert.match(tokenStyles[0][2], /html\[data-theme="dark"\]\{(?:--[\w-]+:[^;{}]+;)+\}/);
  assert.doesNotMatch(`${nonTokenStyles}\n${inlineStyles}`, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);

  const darkTokens = tokenStyles[0][2].match(/html\[data-theme="dark"\]\{([^}]*)\}/)?.[1] || '';
  const tokenValue = name => darkTokens.match(new RegExp(`${name}:([^;]+)`))?.[1];
  const contrast = (first, second) => {
    const luminance = color => {
      const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + .05) / (darker + .05);
  };
  const foregroundPairs = [
    ['--surface', '--text'], ['--surface', '--muted'], ['--surface', '--primary'], ['--surface', '--warning'], ['--surface', '--success'], ['--surface', '--focus'], ['--surface', '--detail-text'], ['--surface', '--overdue-text'],
    ['--warning-surface', '--warning-text'], ['--warm-surface', '--warm-accent'], ['--warm-surface', '--warm-muted'], ['--conflict-surface', '--conflict-text'], ['--icon-surface', '--icon-text'], ['--warning-surface', '--holiday-icon']
  ];
  const borderPairs = [
    ['--surface', '--border'], ['--warning-surface', '--warning-border'], ['--warm-surface', '--warm-border'], ['--conflict-surface', '--conflict-border'], ['--surface', '--quadrant-do'], ['--surface', '--quadrant-plan'], ['--surface', '--quadrant-delegate'], ['--surface', '--quadrant-eliminate'], ['--surface-raised', '--chart-leisure']
  ];

  for (const [background, foreground] of foregroundPairs) assert.ok(contrast(tokenValue(background), tokenValue(foreground)) >= 4.5, `${foreground} must have at least 4.5:1 contrast on ${background}`);
  for (const [background, border] of borderPairs) assert.ok(contrast(tokenValue(background), tokenValue(border)) >= 3, `${border} must have at least 3:1 contrast on ${background}`);
});

test('theme stylesheet gives conflicted course slots contrast-safe light and dark tokens', () => {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const rootTokens = (html.match(/:root\{([^}]*)\}/g) || []).find(rule => rule.includes('--conflict-surface')) || '';
  const darkTokens = html.match(/html\[data-theme="dark"\]\{([^}]*)\}/)?.[1] || '';
  const tokenValue = (tokens, name) => tokens.match(new RegExp(`${name}:([^;]+)`))?.[1];
  const contrast = (first, second) => {
    const luminance = color => {
      const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + .05) / (darker + .05);
  };

  const lightSurface = tokenValue(rootTokens, '--conflict-surface');
  const lightText = tokenValue(rootTokens, '--conflict-text');
  const darkSurface = tokenValue(darkTokens, '--conflict-surface');
  const darkText = tokenValue(darkTokens, '--conflict-text');
  assert.ok(lightSurface && lightText && darkSurface && darkText);
  assert.ok(contrast(lightSurface, lightText) >= 4.5);
  assert.ok(contrast(darkSurface, darkText) >= 4.5);
  assert.match(html, /\.courseSlot\.conflict\{background:var\(--conflict-surface\);color:var\(--conflict-text\);box-shadow:inset 0 0 0 1px var\(--conflict-border\)\}/);
});

test('theme stylesheet gives warm and metadata elements semantic dark-mode contrast tokens', () => {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const rootTokens = (html.match(/:root\{([^}]*)\}/g) || []).find(rule => rule.includes('--warm-surface')) || '';
  const darkTokens = html.match(/html\[data-theme="dark"\]\{([^}]*)\}/)?.[1] || '';
  const tokenValue = (tokens, name) => tokens.match(new RegExp(`${name}:([^;]+)`))?.[1];
  const contrast = (first, second) => {
    const luminance = color => {
      const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + .05) / (darker + .05);
  };

  assert.match(html, /\.form\.warm,\.quickGrid \.warm\{background:var\(--warm-surface\)\}/);
  assert.match(html, /\.holiday\{border-color:var\(--warm-border\);background:var\(--warm-surface\)\}/);
  assert.match(html, /\.holiday span\{color:var\(--warm-accent\)\}/);
  assert.match(html, /\.holiday p,\.holiday small\{color:var\(--warm-muted\)\}/);
  assert.match(html, /h1 em,\.guideStep b\{color:var\(--primary\)\}/);
  assert.match(html, /\.eyebrow,\.focusMode\{color:var\(--muted\)\}/);
  assert.equal(tokenValue(darkTokens, '--warm-surface'), '#33281f');
  assert.equal(tokenValue(darkTokens, '--warm-accent'), '#ffd18a');
  assert.equal(tokenValue(darkTokens, '--warm-muted'), '#e5cfac');
  assert.equal(tokenValue(darkTokens, '--surface'), '#202738');
  assert.equal(tokenValue(darkTokens, '--primary'), '#92a8ff');
  assert.equal(tokenValue(darkTokens, '--muted'), '#b6c0d3');
  assert.ok(contrast(tokenValue(darkTokens, '--warm-surface'), tokenValue(darkTokens, '--warm-accent')) >= 4.5);
  assert.ok(contrast(tokenValue(darkTokens, '--warm-surface'), tokenValue(darkTokens, '--warm-muted')) >= 4.5);
  assert.ok(contrast(tokenValue(darkTokens, '--surface'), tokenValue(darkTokens, '--primary')) >= 4.5);
  assert.ok(contrast(tokenValue(darkTokens, '--surface'), tokenValue(darkTokens, '--muted')) >= 4.5);
  assert.ok(rootTokens);
});

test('theme stylesheet gives compact text and leisure charts independent dark tokens', () => {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const darkTokens = html.match(/html\[data-theme="dark"\]\{([^}]*)\}/)?.[1] || '';
  const tokenValue = name => darkTokens.match(new RegExp(`${name}:([^;]+)`))?.[1];
  const contrast = (first, second) => {
    const luminance = color => {
      const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + .05) / (darker + .05);
  };

  assert.match(html, /\.time b,\.listRow>span b,\.advanced summary,\.courseDay h3\{color:var\(--detail-text\)\}/);
  assert.match(html, /\.advanced summary::before\{color:var\(--primary\)\}/);
  assert.match(html, /\.guideStep p\{color:var\(--muted\)\}/);
  assert.match(html, /\.quadTask\.overdue small\{color:var\(--overdue-text\)\}/);
  assert.match(html, /\.allocation\.leisure,\.allocationLegend\.leisure::before\{background:var\(--chart-leisure\)\}/);
  assert.match(html, /\.icon\{background:var\(--icon-surface\);color:var\(--icon-text\)\}/);
  assert.doesNotMatch(html, /\.allocation\.leisure,\.allocationLegend\.leisure::before\{background:#a277dc\}/);
  assert.equal(tokenValue('--detail-text'), '#d9e1f2');
  assert.equal(tokenValue('--overdue-text'), '#ffb4ab');
  assert.equal(tokenValue('--chart-leisure'), '#cbb8ff');
  assert.equal(tokenValue('--icon-surface'), '#323d54');
  assert.equal(tokenValue('--icon-text'), '#e3ebff');
  assert.ok(contrast(tokenValue('--surface'), tokenValue('--detail-text')) >= 4.5);
  assert.ok(contrast(tokenValue('--surface'), tokenValue('--overdue-text')) >= 4.5);
  assert.ok(contrast(tokenValue('--icon-surface'), tokenValue('--icon-text')) >= 4.5);
});

test('appearance changes apply and persist immediately without changing language', () => {
  const harness = interactionHarness({
    settings: { wake: '07:00', sleep: '22:30', play: 60, language: 'en', theme: 'system' }
  });

  harness.selectTab('settings');
  harness.changeTheme('dark');

  assert.equal(harness.root.dataset.theme, 'dark');
  assert.deepEqual(JSON.parse(harness.savedWrites.at(-1).value).settings, {
    wake: '07:00', sleep: '22:30', play: 60, language: 'en', theme: 'dark', navigationLayout: 'top'
  });
});

test('settings form offers the saved appearance and persists an updated preference', () => {
  const harness = interactionHarness({
    settings: { wake: '07:00', sleep: '22:30', play: 60, language: 'en', theme: 'system' }
  });

  harness.selectTab('settings');
  assert.match(harness.markup, /name="theme"/);
  harness.submitForm('settings', { wake: '06:30', sleep: '22:00', play: '30', theme: 'dark' });

  const saved = JSON.parse(harness.savedWrites.at(-1).value);
  assert.equal(saved.settings.theme, 'dark');
});

test('settings form preserves the saved theme alongside the selected language', () => {
  const harness = interactionHarness({
    settings: { wake: '07:00', sleep: '22:30', play: 60, language: 'en', theme: 'dark', navigationLayout: 'top' }
  });

  harness.selectTab('settings');
  harness.submitForm('settings', { wake: '06:30', sleep: '22:00', play: '30' });

  const saved = JSON.parse(harness.savedWrites.at(-1).value);
  assert.deepEqual(saved.settings, { wake: '06:30', sleep: '22:00', play: 30, language: 'en', theme: 'dark', navigationLayout: 'top' });
});

test('app shell saves desktop navigation layout while keeping a shared mobile navigation', () => {
  const harness = interactionHarness({
    settings: { wake: '07:00', sleep: '22:30', play: 60, language: 'en', theme: 'system', navigationLayout: 'top' }
  });

  assert.match(harness.markup, /data-navigation-layout="top"/);
  assert.match(harness.markup, /data-mobile-nav/);
  harness.selectTab('settings');
  assert.match(harness.markup, /name="navigationLayout"/);
  harness.submitForm('settings', { wake: '07:00', sleep: '22:30', play: '60', theme: 'system', navigationLayout: 'sidebar' });

  assert.equal(JSON.parse(harness.savedWrites.at(-1).value).settings.navigationLayout, 'sidebar');
  assert.match(harness.markup, /data-navigation-layout="sidebar"/);
  assert.match(harness.markup, /data-mobile-nav/);
});

test('English sidebar and mobile More expose every navigation destination', () => {
  const harness = interactionHarness({
    settings: { wake: '07:00', sleep: '22:30', play: 60, language: 'en', theme: 'system', navigationLayout: 'sidebar' }
  });

  assert.doesNotMatch(harness.markup, />执行</);
  harness.pressCommand('mobile-more');
  assert.match(harness.markup, /data-tab="analytics"/);
});

test('keyed dynamic notices use English templates and preserve task names', () => {
  const planner = loadPlanner();
  const title = planner.userField('课程');

  assert.equal(planner.message('notice.scheduled', { start: '09:00', end: '09:45', title }, 'en'), 'Scheduled: 09:00 — 09:45, 课程');
  assert.equal(planner.message('reminder.overdue', { title }, 'en'), 'Task overdue: 课程');
  assert.equal(planner.message('reminder.startsSoon', { time: '09:00', title }, 'en'), '09:00 starts soon: 课程');
});

test('protected HTML messages escape user text before entering the timeline', () => {
  const planner = loadPlanner();
  const maliciousTitle = '<img src=x onerror=alert(1)>';

  assert.equal(
    planner.renderProtectedMessage('holiday.studyPrefix', { title: planner.userField(maliciousTitle) }, 'zh-CN'),
    '假期学习：&lt;img src=x onerror=alert(1)&gt;'
  );
});

test('English translations keep priority labels and use ASCII sentence punctuation', () => {
  const planner = loadPlanner();

  assert.equal(planner.translate('高优先级', 'en'), 'High priority');
  assert.equal(planner.translate('低优先级', 'en'), 'Low priority');
  assert.equal(planner.translate('任务会自动排进空闲时间。', 'en'), 'Tasks are placed into your available time automatically.');
});

test('rendered user fields are explicitly marked and never translated by their value', () => {
  const planner = loadPlanner();

  assert.equal(planner.renderUserField('课程'), '<span data-user-field>课程</span>');
  assert.equal(planner.renderUserField('地点'), '<span data-user-field>地点</span>');
  assert.equal(planner.renderUserField('假期备注'), '<span data-user-field>假期备注</span>');
});

test('runtime reminders select the active language before rendering', () => {
  const planner = loadPlanner({ settings: { language: 'en' } });
  const reminder = planner.getReminder(
    { id: 'task-1', kind: 'task', title: '课程', start: '2030-01-01T09:00:00', end: '2030-01-01T10:00:00' },
    '2030-01-01T08:55:00'
  );

  assert.match(reminder, /^09:00 starts soon:/);
  assert.equal(planner.translate(reminder, 'en'), '09:00 starts soon: 课程');
});

test('queued reminder descriptors render in the language selected after enqueueing', () => {
  const planner = loadPlanner();
  const notice = planner.reminderNotice('reminder.overdue', { title: planner.userField('课程') });

  assert.equal(planner.renderReminderNotice(notice, 'zh-CN'), '任务已逾期：课程');
  assert.equal(planner.renderReminderNotice(notice, 'en'), 'Task overdue: 课程');
});

test('only generated holiday tasks receive the localized system prefix', () => {
  const planner = loadPlanner();

  assert.equal(planner.displayTaskTitle({ title: '复习 · 08-26', generatedHoliday: true }, 'en'), 'Break study: 复习 · 08-26');
  assert.equal(planner.displayTaskTitle({ title: '假期学习：我的任务' }, 'en'), '假期学习：我的任务');
});

test('generated holiday titles use one renderer across view and reminder paths', () => {
  const planner = loadPlanner();
  const generated = { id: 'holiday-1', title: '复习 · 08-26', generatedHoliday: true };
  const ordinary = { id: 'task-1', title: '假期学习：我的任务' };

  assert.equal(planner.renderTaskTitle(generated, 'en'), 'Break study: 复习 · 08-26');
  assert.equal(planner.renderTaskTitle(generated, 'zh-CN'), '假期学习：复习 · 08-26');
  assert.equal(planner.renderTaskTitle(ordinary, 'en'), '假期学习：我的任务');
  assert.equal(
    planner.renderReminderNotice(planner.reminderNotice('reminder.overdue', { title: planner.userField(generated.title), generatedHoliday: true }), 'en'),
    'Task overdue: Break study: 复习 · 08-26'
  );
});

test('persisted task titles are never parsed to infer holiday ownership', () => {
  const planner = loadPlanner();

  assert.equal(planner.protectedTaskTitle({ title: '假期学习：我的任务' }), '假期学习：我的任务');
  assert.equal(planner.protectedTaskTitle({ title: '假期学习：我的任务', date: '2026-08-26' }), '假期学习：我的任务');
});

test('browser title is TimeSprout in both languages', () => {
  assert.equal(renderedTitle('zh-CN'), 'TimeSprout');
  assert.equal(renderedTitle('en'), 'TimeSprout');
});

test('large task queues prefer shorter equally urgent tasks when that schedules more work', () => {
  const planner = loadPlanner();
  const result = planner.schedule({
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '09:00', fixed: [],
    tasks: [
      { id: 'a-long', title: 'Long', duration: 60, due: '2030-01-01T09:00:00', priority: 'high' },
      { id: 'b-short', title: 'Short 1', duration: 30, due: '2030-01-01T09:00:00', priority: 'high' },
      { id: 'c-short', title: 'Short 2', duration: 30, due: '2030-01-01T09:00:00', priority: 'high' },
      ...['d', 'e', 'f', 'g', 'h', 'i'].map(id => ({ id, title: id, duration: 120, due: '2030-01-01T09:00:00', priority: 'high' }))
    ]
  });

  assert.deepEqual(result.blocks.map(block => block.id), ['b-short', 'c-short']);
  assert.equal(result.unscheduled.length, 7);
});

test('small task queues maximize scheduled work before the established ID tie-breaker', () => {
  const planner = loadPlanner();
  const result = planner.schedule({
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '09:00', fixed: [],
    tasks: [
      { id: 'a-long', title: 'Long', duration: 60, due: '2030-01-01T09:00:00', priority: 'high' },
      { id: 'b-short', title: 'Short 1', duration: 30, due: '2030-01-01T09:00:00', priority: 'high' },
      { id: 'c-short', title: 'Short 2', duration: 30, due: '2030-01-01T09:00:00', priority: 'high' }
    ]
  });

  assert.deepEqual(result.blocks.map(block => block.id), ['b-short', 'c-short']);
});

test('large queues place inflexible work before a shorter flexible task', () => {
  const planner = loadPlanner();
  const result = planner.schedule({
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '10:30',
    fixed: [{ id: 'break', title: 'Break', start: '2030-01-01T09:00:00', end: '2030-01-01T10:00:00', kind: 'locked' }],
    tasks: [
      { id: 'a-flexible', title: 'Flexible', duration: 30, priority: 'high', due: '2030-01-01T10:30:00' },
      { id: 'b-inflexible', title: 'Inflexible', duration: 60, priority: 'high', due: '2030-01-01T10:30:00' },
      ...['c', 'd', 'e', 'f', 'g', 'h', 'i'].map(id => ({ id, title: id, duration: 120, priority: 'high', due: '2030-01-01T10:30:00' }))
    ]
  });

  assert.deepEqual(result.blocks.filter(block => block.kind === 'task').map(block => block.id), ['b-inflexible', 'a-flexible']);
});

test('candidate comparison prefers deadline risk, then priority, before lower score dimensions', () => {
  const planner = loadPlanner();
  const earlyLow = { id: 'early-low', due: '2030-01-01T09:00:00', priority: 'low', duration: 60 };
  const earlyHigh = { id: 'early-high', due: '2030-01-01T09:00:00', priority: 'high', duration: 60 };
  const lateHigh = { id: 'late-high', due: '2030-01-01T10:00:00', priority: 'high', duration: 60 };

  assert.ok(planner.compareScheduleCandidates([{ task: earlyLow, slot: new Date('2030-01-01T08:00:00') }], [{ task: lateHigh, slot: new Date('2030-01-01T08:00:00') }], [lateHigh, earlyLow]) < 0);
  assert.ok(planner.compareScheduleCandidates([{ task: earlyHigh, slot: new Date('2030-01-01T08:00:00') }], [{ task: earlyLow, slot: new Date('2030-01-01T08:00:00') }], [earlyLow, earlyHigh]) < 0);
});

test('deadline and priority ordering is unchanged when a queue crosses the old size threshold', () => {
  const planner = loadPlanner();
  const scheduleOne = (primary, secondary, fillerCount) => planner.schedule({
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '09:00', fixed: [],
    tasks: [primary, secondary, ...Array.from({ length: fillerCount }, (_, index) => ({
      id: `filler-${index}`, title: `Filler ${index}`, duration: 120, due: '2030-01-01T12:00:00', priority: 'low'
    }))]
  }).blocks.filter(block => block.kind === 'task').map(block => block.id);

  for (const fillerCount of [0, 7]) {
    assert.deepEqual(scheduleOne(
      { id: 'late-high', title: 'Late high', duration: 60, due: '2030-01-01T10:00:00', priority: 'high' },
      { id: 'early-low', title: 'Early low', duration: 60, due: '2030-01-01T09:00:00', priority: 'low' },
      fillerCount
    ), ['early-low']);
    assert.deepEqual(scheduleOne(
      { id: 'same-low', title: 'Same low', duration: 60, due: '2030-01-01T09:00:00', priority: 'low' },
      { id: 'same-high', title: 'Same high', duration: 60, due: '2030-01-01T09:00:00', priority: 'high' },
      fillerCount
    ), ['same-high']);
  }
});

test('candidate ties retain deterministic ID order and repeated schedules are identical', () => {
  const planner = loadPlanner();
  const input = {
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '09:00', fixed: [],
    tasks: [
      { id: 'b-task', title: 'B', duration: 60, due: '2030-01-01T09:00:00', priority: 'high' },
      { id: 'a-task', title: 'A', duration: 60, due: '2030-01-01T09:00:00', priority: 'high' }
    ]
  };

  const first = planner.schedule(input);
  assert.deepEqual(first.blocks.map(block => block.id), ['a-task']);
  for (let index = 0; index < 5; index++) assert.deepEqual(planner.schedule(input), first);
});

test('candidate comparison minimizes fragmentation before deterministic placement ties', () => {
  const planner = loadPlanner();
  const first = { id: 'a-task', due: '2030-01-01T12:00:00', priority: 'high', duration: 30 };
  const second = { id: 'b-task', due: '2030-01-01T12:00:00', priority: 'high', duration: 30 };
  const fragmented = [
    { task: first, slot: new Date('2030-01-01T08:00:00') },
    { task: second, slot: new Date('2030-01-01T09:00:00') }
  ];
  const contiguous = [
    { task: first, slot: new Date('2030-01-01T10:00:00') },
    { task: second, slot: new Date('2030-01-01T10:30:00') }
  ];

  assert.ok(planner.compareScheduleCandidates(contiguous, fragmented, [first, second]) < 0);
});

test('fixed search cap falls back to the same score and still maximizes the scheduled count', () => {
  const planner = loadPlanner();
  const result = planner.schedule({
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '09:00', fixed: [],
    tasks: [
      ...'abcdefghij'.split('').map(id => ({ id: `${id}-long`, title: id, duration: 15, due: '2030-01-01T09:00:00', priority: 'high' })),
      ...'klmnopqr'.split('').map(id => ({ id: `${id}-short`, title: id, duration: 10, due: '2030-01-01T09:00:00', priority: 'high' }))
    ]
  });

  assert.deepEqual(result.blocks.map(block => block.id), ['k-short', 'l-short', 'm-short', 'n-short', 'o-short', 'p-short']);
});

test('fixed blocks and public task block shapes remain intact while leisure follows required work', () => {
  const planner = loadPlanner();
  const fixed = { id: 'class', title: 'Class', start: '2030-01-01T09:00:00', end: '2030-01-01T10:00:00', kind: 'locked' };
  const tooLate = { id: 'too-late', title: 'Too late', duration: 60, due: '2030-01-01T08:30:00', priority: 'high' };
  const result = planner.schedule({
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '11:00', fixed: [fixed],
    tasks: [
      { id: 'leisure', title: 'Leisure', duration: 30, due: '2030-01-01T11:00:00', priority: 'low', leisure: true },
      { id: 'required', title: 'Required', duration: 60, due: '2030-01-01T11:00:00', priority: 'high' },
      tooLate
    ]
  });

  assert.deepEqual(result.blocks[1], fixed);
  assert.deepEqual(result.blocks.filter(block => block.kind === 'task'), [
    { id: 'required', taskId: 'required', title: 'Required', start: '2030-01-01T08:00:00', end: '2030-01-01T09:00:00', kind: 'task', leisure: false },
    { id: 'leisure', taskId: 'leisure', title: 'Leisure', start: '2030-01-01T10:00:00', end: '2030-01-01T10:30:00', kind: 'task', leisure: true }
  ]);
  assert.deepEqual(result.unscheduled, [tooLate]);
});

test('leisure cannot backfill a short gap before the latest required task ends', () => {
  const planner = loadPlanner();
  const result = planner.schedule({
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '11:00',
    fixed: [{ id: 'break', title: 'Break', start: '2030-01-01T08:30:00', end: '2030-01-01T09:00:00', kind: 'locked' }],
    tasks: [
      { id: 'required', title: 'Required', duration: 60, due: '2030-01-01T11:00:00', priority: 'high' },
      { id: 'leisure', title: 'Leisure', duration: 30, due: '2030-01-01T11:00:00', priority: 'low', leisure: true }
    ]
  });

  assert.deepEqual(result.blocks.filter(block => block.kind === 'task').map(block => [block.id, block.start, block.end]), [
    ['required', '2030-01-01T09:00:00', '2030-01-01T10:00:00'],
    ['leisure', '2030-01-01T10:00:00', '2030-01-01T10:30:00']
  ]);
});

test('large bounded search reads scoring fields within a fixed operation budget', () => {
  const planner = loadPlanner();
  let scoringReads = 0;
  const tasks = 'abcdefghijklmn'.split('').map((id, index) => ({
    id, title: id,
    get duration() { scoringReads++; return index < 8 ? 15 : 10; },
    get due() { scoringReads++; return '2030-01-01T09:00:00'; },
    get priority() { scoringReads++; return 'high'; }
  }));

  const result = planner.schedule({
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '09:00', fixed: [], tasks
  });

  assert.deepEqual(result.blocks.map(block => block.id), ['i', 'j', 'k', 'l', 'm', 'n']);
  assert.ok(scoringReads < 1000, `expected fewer than 1000 scoring-field reads, received ${scoringReads}`);
});

test('protected required leisure still starts after all non-leisure work', () => {
  const planner = loadPlanner();
  const result = planner.schedule({
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '11:00',
    fixed: [{ id: 'break', title: 'Break', start: '2030-01-01T08:30:00', end: '2030-01-01T09:00:00', kind: 'locked' }],
    tasks: [
      { id: 'required-work', title: 'Required work', duration: 60, due: '2030-01-01T11:00:00', priority: 'high' },
      { id: 'daily-play', title: 'Daily play', duration: 30, due: '2030-01-01T11:00:00', priority: 'low', leisure: true, required: true }
    ]
  });

  assert.deepEqual(result.blocks.filter(block => block.kind === 'task').map(block => [block.id, block.start, block.end]), [
    ['required-work', '2030-01-01T09:00:00', '2030-01-01T10:00:00'],
    ['daily-play', '2030-01-01T10:00:00', '2030-01-01T10:30:00']
  ]);
});

test('protected leisure remains eligible before optional leisure without moving ahead of work', () => {
  const planner = loadPlanner();
  const result = planner.schedule({
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '10:00', fixed: [],
    tasks: [
      { id: 'work', title: 'Work', duration: 60, due: '2030-01-01T10:00:00', priority: 'high' },
      { id: 'daily-play', title: 'Daily play', duration: 60, due: '2030-01-01T10:00:00', priority: 'low', leisure: true, required: true },
      { id: 'optional-play', title: 'Optional play', duration: 60, due: '2030-01-01T10:00:00', priority: 'high', leisure: true }
    ]
  });

  assert.deepEqual(result.blocks.filter(block => block.kind === 'task').map(block => block.id), ['work', 'daily-play']);
  assert.deepEqual(result.unscheduled.map(task => task.id), ['optional-play']);
});

test('five hundred task scheduling stays deterministic within a responsive work budget', () => {
  const planner = loadPlanner();
  const tasks = Array.from({ length: 500 }, (_, index) => ({
    id: `task-${String(index).padStart(3, '0')}`, title: `Task ${index}`,
    duration: index % 5 === 0 ? 15 : 10, due: '2030-01-01T09:00:00', priority: 'high'
  }));
  const input = {
    date: '2030-01-01', now: '2030-01-01T07:00:00', dayStart: '08:00', dayEnd: '09:00', fixed: [], tasks
  };

  const started = performance.now();
  const first = planner.schedule(input);
  const elapsed = performance.now() - started;

  assert.deepEqual(first.blocks.map(block => block.id), ['task-001', 'task-002', 'task-003', 'task-004', 'task-006', 'task-007']);
  assert.deepEqual(planner.schedule(input), first);
  assert.ok(elapsed < 1000, `expected 500 tasks in under 1000 ms, received ${elapsed.toFixed(1)} ms`);
});

test('English static copy ignores matching user titles while notices preserve marked user fields', () => {
  const planner = loadPlanner();
  const courseTitle = '课程';

  assert.equal(planner.localizeText('课程、临时事项或正在打卡的任务发生重叠，请调整其中一项。', 'en', [courseTitle], false), 'Courses, events, or active tasks overlap. Adjust one of them.');
  assert.equal(planner.translate(planner.getReminder({ id: 'task-1', kind: 'task', title: courseTitle, start: '2030-01-01T09:00:00', end: '2030-01-01T10:00:00' }, '2030-01-01T09:30:00'), 'en'), 'Do now: 课程');
  const zhPlanner = loadPlanner({ settings: { language: 'zh-CN' } });
  assert.equal(zhPlanner.translate(zhPlanner.getReminder({ id: 'task-1', kind: 'task', title: courseTitle, start: '2030-01-01T09:00:00', end: '2030-01-01T10:00:00' }, '2030-01-01T09:30:00'), 'zh-CN'), '现在该做：课程');
  assert.deepEqual(planner.userTextValuesForNode('起床与晨间准备', ['起床']), []);
  assert.deepEqual(planner.userTextValuesForNode('假期学习：我的任务', ['我的任务']), ['我的任务']);
  assert.equal(localizedStatusTextWithMatchingTaskTitle('起床与晨间准备'), 'Wake-up and morning routine');
  const livePlanner = loadPlanner({ settings: { language: 'en' }, tasks: [{ id: 'task-1', title: '课程', duration: 30, due: '2030-01-01T12:00:00' }] });
  const liveTitle = livePlanner.liveDashboardValues({ blocks: [{ id: 'task-1', title: '课程', start: '2030-01-01T09:00:00', end: '2030-01-01T10:00:00' }] }, '2030-01-01T09:30:00').currentTitle;
  assert.equal(livePlanner.translate(liveTitle, 'en'), '课程');
});

test('calendar navigation preserves the selected day and clamps it at month end', () => {
  const planner = loadPlanner();

  assert.equal(planner.shiftCalendarMonth('2030-01-15', 1), '2030-02-15');
  assert.equal(planner.shiftCalendarMonth('2030-01-31', 1), '2030-02-28');
  assert.equal(planner.shiftCalendarMonth('2032-03-31', -1), '2032-02-29');
});

test('calendar navigation keeps date-only selections stable west of UTC', () => {
  const output = execFileSync(process.execPath, ['-e', `
    const fs = require('node:fs');
    const html = fs.readFileSync(${JSON.stringify(appHtmlPath)}, 'utf8');
    const script = html.match(/<script>([\\s\\S]*?)<\\/script>/)[1];
    global.localStorage = { getItem: () => JSON.stringify({ settings: { language: 'en' } }), setItem: () => {} };
    eval(script);
    console.log(JSON.stringify([
      global.AgendaPlanner.shiftCalendarMonth('2030-01-15', 1),
      global.AgendaPlanner.shiftCalendarMonth('2030-03-15', -1)
    ]));
  `], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' } });

  assert.deepEqual(JSON.parse(output), ['2030-02-15', '2030-02-15']);
});

test('reminder refresh uses live regions without a full render when no notice is due', () => {
  const planner = loadPlanner();
  const nodes = new Map(['clock', 'currentTitle', 'currentTime', 'nextTitle', 'nextTime', 'pending', 'overdue'].map(key => [key, { textContent: '' }]));
  const root = { querySelector: selector => nodes.get(selector.slice(11, -1)) || null };

  assert.equal(planner.reminderRefreshMode(false, false, 'today'), 'live');
  assert.equal(planner.reminderRefreshMode(true, false, 'today'), 'render');
  assert.equal(planner.reminderRefreshMode(false, true, 'today'), 'none');
  assert.equal(planner.updateLiveDashboard(root, { clock: '09:30', currentTitle: '任务', currentTime: '09:00 — 10:00', nextTitle: '暂无安排', nextTime: '留给休息或复习', pending: '2 项', overdue: '1 项已逾期' }), true);
  assert.deepEqual(Object.fromEntries([...nodes].map(([key, node]) => [key, node.textContent])), { clock: '09:30', currentTitle: '任务', currentTime: '09:00 — 10:00', nextTitle: '暂无安排', nextTime: '留给休息或复习', pending: '2 项', overdue: '1 项已逾期' });
});

test('calendar navigation returns matching cursor and selected dates at month end', () => {
  const planner = loadPlanner();

  assert.deepEqual(planner.moveCalendarSelection('2030-01-31', 1), {
    selectedDate: '2030-02-28',
    cursorDate: '2030-02-28'
  });
});

test('calendar navigation preserves ordinary days in both directions', () => {
  const planner = loadPlanner();

  assert.deepEqual(planner.moveCalendarSelection('2030-01-15', 1), {
    selectedDate: '2030-02-15',
    cursorDate: '2030-02-15'
  });
  assert.deepEqual(planner.moveCalendarSelection('2030-03-15', -1), {
    selectedDate: '2030-02-15',
    cursorDate: '2030-02-15'
  });
});

test('reminder refresh mode renders notices, preserves edits, and live-updates Today', () => {
  const planner = loadPlanner();

  assert.equal(planner.refreshMode(false, false, 'today'), 'live');
  assert.equal(planner.refreshMode(true, false, 'today'), 'render');
  assert.equal(planner.refreshMode(true, true, 'today'), 'none');
  assert.equal(planner.refreshMode(false, false, 'calendar'), 'none');
});

test('live dashboard values deterministically populate every marked field', () => {
  const planner = loadPlanner({
    settings: { language: 'en' },
    tasks: [
      { id: 'current', title: '课程', duration: 30, due: '2030-01-01T11:00:00', status: 'pending' },
      { id: 'next', title: 'Reading', duration: 30, due: '2030-01-01T08:00:00', status: 'pending' }
    ]
  });

  assert.deepEqual(planner.buildLiveDashboardValues({
    blocks: [
      { id: 'current', title: '课程', start: '2030-01-01T09:00:00', end: '2030-01-01T10:00:00' },
      { id: 'next', title: 'Reading', start: '2030-01-01T10:00:00', end: '2030-01-01T10:30:00' }
    ]
  }, '2030-01-01T09:30:00'), {
    clock: '09:30',
    currentTitle: '课程',
    currentTime: '09:00 — 10:00',
    nextTitle: 'Reading',
    nextTime: '10:00 Start',
    pending: '2 items',
    overdue: '1 overdue'
  });
});

test('quiet live refresh changes marked values without assigning app innerHTML', () => {
  const planner = loadPlanner();
  const nodes = new Map(['clock', 'currentTitle', 'currentTime', 'nextTitle', 'nextTime', 'pending', 'overdue'].map(key => [key, { textContent: '' }]));
  let assignedInnerHtml = false;
  const root = {
    querySelector: selector => nodes.get(selector.slice(11, -1)) || null,
    set innerHTML(value) {
      assignedInnerHtml = true;
      throw new Error(`quiet update attempted a full render: ${value}`);
    }
  };
  const values = { clock: '09:30', currentTitle: 'Task', currentTime: '09:00 — 10:00', nextTitle: 'None', nextTime: 'Later', pending: '2 items', overdue: 'No overdue tasks' };

  assert.equal(planner.refreshMode(false, false, 'today'), 'live');
  assert.equal(planner.updateLiveDashboard(root, values), true);
  assert.equal(assignedInnerHtml, false);
  assert.deepEqual(Object.fromEntries([...nodes].map(([key, node]) => [key, node.textContent])), values);
});

test('initial English live titles preserve user text before and after a quiet refresh', () => {
  const now = new Date();
  const event = {
    id: 'event-1', title: '课程', kind: 'event',
    start: localDateTime(new Date(now.getTime() - 60_000)),
    end: localDateTime(new Date(now.getTime() + 30 * 60_000))
  };

  assert.deepEqual(
    initialAndQuietLiveTitle(
      { settings: { wake: '00:00', sleep: '23:59', play: 60, language: 'en' }, events: [event] },
      { blocks: [event] },
      now
    ),
    { initial: '课程', quiet: '课程' }
  );
});

test('interaction harness keeps a user task title while language controls render English UI', () => {
  const now = new Date();
  const harness = interactionHarness({
    settings: { wake: '00:00', sleep: '23:59', play: 0, language: 'zh-CN' },
    tasks: [{ id: 'course-task', title: '课程', duration: 30, due: localDateTime(new Date(now.getTime() + 60 * 60_000)), status: 'pending' }]
  });
  const before = harness.renderCount;

  harness.changeLanguage('en');

  assert.equal(harness.renderCount, before + 1);
  assert.match(harness.markup, /Your plan for today/);
  assert.match(harness.markup, /课程/);
});

test('interaction harness quiet reminder polling preserves opened advanced settings', () => {
  const harness = interactionHarness({ settings: { wake: '00:00', sleep: '23:59', play: 0, language: 'en' } });
  harness.advanced.open = true;
  const before = harness.renderCount;

  harness.runQuietReminderPoll();

  assert.equal(harness.renderCount, before);
  assert.equal(harness.advanced.open, true);
  assert.ok(harness.liveUpdateCount > 0);
});

test('controller interactions use one canonical render entry point', () => {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  const harness = interactionHarness({ settings: { language: 'zh-CN' } });
  const initialRenders = harness.renderCount;

  harness.changeLanguage('en');
  harness.selectTab('calendar');

  assert.equal(harness.renderCount, initialRenders + 2);
  assert.match(harness.markup, /Calendar/);
  assert.equal((html.match(/function renderApp\(/g) || []).length, 1);
  assert.equal((html.match(/function render\(/g) || []).length, 0);
  assert.equal((html.match(/function todayView\(/g) || []).length, 1);
});

test('legacy saved state retains supported persisted values under the established storage key', () => {
  const undoState = {
    courses: [{ id: 'undo-course-1', title: '英语', day: 2, start: '10:00', end: '10:45', location: 'B-202' }],
    tasks: [{ id: 'undo-task-1', title: '旧任务', duration: 30, due: '2030-08-26T19:00:00', priority: 'low', status: 'pending', important: false, urgent: true, leisure: false, date: '2030-08-26', completed: false, completedAt: '' }],
    events: [{ id: 'undo-event-1', title: '班会', start: '2030-08-26T16:00:00', end: '2030-08-26T16:30:00', kind: 'event' }],
    holidays: [{ id: 'undo-holiday-1', title: '秋假', start: '2030-10-01', end: '2030-10-07', minutes: 60, notes: '读完一本书' }],
    settings: { wake: '06:30', sleep: '23:00', play: 90, language: 'en' },
    focus: { taskId: 'undo-task-1', mode: 'focus', running: false, remainingSeconds: 1500, startedAt: '', completedPomodoros: 1, totalSeconds: 1500, lastTick: 0 },
    history: [{ id: 'undo-history-1', reason: '添加任务', at: '2030-08-26T17:30:00' }]
  };
  const saved = {
    courses: [{ id: 'course-1', title: '高等数学', day: 1, start: '08:00', end: '09:40', location: 'A-301' }],
    tasks: [{ id: 'task-1', title: '复习 · 08-26', duration: 45, due: '2030-08-26T20:00:00', priority: 'high', status: 'completed', important: true, urgent: true, leisure: true, date: '2030-08-26', startedAt: '2030-08-26T18:15:00', completed: true, completedAt: '2030-08-26T19:00:00' }],
    events: [{ id: 'event-1', title: '社团活动', start: '2030-08-26T14:00:00', end: '2030-08-26T15:30:00', kind: 'locked', oneTimeBreak: true }],
    holidays: [{ id: 'holiday-1', title: '暑假', start: '2030-08-25', end: '2030-08-31', minutes: 90, notes: '完成一套卷子，读书 30 分钟' }],
    settings: { wake: '06:30', sleep: '23:00', play: 90, language: 'en' },
    focus: { taskId: 'task-1', mode: 'break', running: true, remainingSeconds: 240, startedAt: '2030-08-26T18:15:00', completedPomodoros: 3, totalSeconds: 4500, lastTick: 1_930_000_000_000 },
    history: [{ id: 'history-1', reason: '添加任务', at: '2030-08-26T18:00:00' }],
    undo: { reason: '调整作息', state: undoState }
  };
  const { planner, requestedKey, loadedState } = loadPlannerWithStorageKey(saved);
  const normalized = planner.normalizeState(saved);

  assert.equal(requestedKey, 'student-agenda-single-v1');
  assert.equal(planner.isValidUndoSnapshot(saved.undo), true);
  assert.deepEqual(loadedState, normalized);
  assert.deepEqual(loadedState.courses, saved.courses);
  assert.deepEqual(loadedState.tasks, saved.tasks);
  assert.deepEqual(loadedState.events, saved.events);
  assert.deepEqual(loadedState.holidays, saved.holidays);
  assert.deepEqual(loadedState.settings, { ...saved.settings, theme: 'system', navigationLayout: 'top' });
  assert.deepEqual(loadedState.focus, saved.focus);
  assert.deepEqual(loadedState.history, saved.history);
  assert.equal(loadedState.undo.reason, saved.undo.reason);
  assert.deepEqual(loadedState.undo.state.courses, undoState.courses);
  assert.deepEqual(loadedState.undo.state.tasks, undoState.tasks);
  assert.deepEqual(loadedState.undo.state.events, undoState.events);
  assert.deepEqual(loadedState.undo.state.holidays, undoState.holidays);
  assert.deepEqual(loadedState.undo.state.settings, { ...undoState.settings, theme: 'system', navigationLayout: 'top' });
  assert.deepEqual(loadedState.undo.state.focus, undoState.focus);
  assert.deepEqual(loadedState.undo.state.history, undoState.history);
});

test('calendar task uses the selected date, routine end, and untouched title', () => {
  const planner = loadPlanner();
  const task = planner.createCalendarTask(
    { title: '课程', duration: 45, priority: 'high' },
    '2030-02-28', { wake: '07:00', sleep: '22:30' }, 'calendar-1'
  );

  assert.deepEqual(task, {
    id: 'calendar-1', title: '课程', duration: 45, priority: 'high',
    due: '2030-02-28T22:30:00', date: '2030-02-28',
    important: true, urgent: false, leisure: false, status: 'pending'
  });
});

test('calendar task stays on its selected date when overnight sleep moves its due time to tomorrow', () => {
  const planner = loadPlanner();
  const task = planner.createCalendarTask(
    { title: 'Night review', duration: 30, priority: 'medium' },
    '2030-02-28', { wake: '07:00', sleep: '01:00' }, 'calendar-overnight'
  );
  const state = { courses: [], tasks: [task], events: [] };

  assert.equal(task.due, '2030-03-01T01:00:00');
  assert.deepEqual(planner.entriesForDate(state, '2030-02-28'), [{ title: 'Night review', type: 'task', generatedHoliday: false }]);
  assert.deepEqual(planner.entriesForDate(state, '2030-03-01'), []);
});

test('delaying a calendar task moves its scheduling date forward with its due date', () => {
  const harness = interactionHarness({
    settings: { wake: '07:00', sleep: '22:30', play: 0, language: 'en' },
    tasks: [{ id: 'calendar-task', title: 'Move me', duration: 30, due: '2026-08-27T22:30:00', date: '2026-08-27', priority: 'medium', status: 'pending' }]
  });

  harness.pressTaskAction('calendar-task', 'delay');

  const saved = JSON.parse(harness.savedWrites.at(-1).value);
  assert.equal(saved.tasks[0].due, '2026-08-28T22:30');
  assert.equal(saved.tasks[0].date, '2026-08-28');
});

function completeBackupState(planner) {
  const undoState = {
    courses: [{ id: 'undo-course', title: '英语', day: 2, start: '10:00', end: '10:45', location: 'B-202' }],
    tasks: [{ id: 'undo-task', title: '旧任务', duration: 30, due: '2030-08-26T19:00:00', priority: 'low', status: 'pending', important: false, urgent: true, leisure: false, date: '2030-08-26', completed: false, completedAt: '' }],
    events: [{ id: 'undo-event', title: '班会', start: '2030-08-26T16:00:00', end: '2030-08-26T16:30:00', kind: 'event' }],
    holidays: [{ id: 'undo-holiday', title: '秋假', start: '2030-10-01', end: '2030-10-07', minutes: 60, notes: '读完一本书' }],
    settings: { wake: '06:30', sleep: '23:00', play: 90, language: 'en' },
    focus: { taskId: 'undo-task', mode: 'focus', running: false, remainingSeconds: 1500, startedAt: '', completedPomodoros: 1, totalSeconds: 1500, lastTick: 0 },
    history: [{ id: 'undo-history', reason: '添加任务', at: '2030-08-26T17:30:00' }]
  };
  return planner.normalizeState({
    courses: [{ id: 'course', title: '数学', day: 1, start: '08:00', end: '09:40', location: 'A-301' }],
    tasks: [{ id: 'task', title: '课程', duration: 45, due: '2030-08-26T20:00:00', priority: 'high', status: 'completed', important: true, urgent: true, leisure: true, date: '2030-08-26', startedAt: '2030-08-26T18:15:00', completed: true, completedAt: '2030-08-26T19:00:00' }],
    events: [{ id: 'event', title: '社团活动', start: '2030-08-26T14:00:00', end: '2030-08-26T15:30:00', kind: 'locked', oneTimeBreak: true }],
    holidays: [{ id: 'holiday', title: '暑假', start: '2030-08-25', end: '2030-08-31', minutes: 90, notes: '完成一套卷子' }],
    settings: { wake: '06:30', sleep: '23:00', play: 90, language: 'en' },
    focus: { taskId: 'task', mode: 'break', running: true, remainingSeconds: 240, startedAt: '2030-08-26T18:15:00', completedPomodoros: 3, totalSeconds: 4500, lastTick: 1_930_000_000_000 },
    history: [{ id: 'history', reason: '添加任务', at: '2030-08-26T18:00:00' }],
    undo: { reason: '调整作息', state: undoState }
  });
}

test('backup round trips normalized plan data including history and valid undo snapshots', () => {
  const planner = loadPlanner();
  const state = completeBackupState(planner);
  const text = planner.serializeBackup(state);

  assert.match(text, /^TimeSprout backup v2\n/);
  assert.deepEqual(planner.parseBackup(text), { ok: true, state });
  assert.equal(planner.isValidUndoSnapshot(state.undo), true);
});

test('legacy state migrates theme and analytics defaults', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({ settings: { wake: '06:30', sleep: '22:00', play: 30 } });

  assert.equal(state.settings.theme, 'system');
  assert.deepEqual(state.analytics, { daily: {} });
});

test('v1 backup still imports with default theme and empty analytics', () => {
  const planner = loadPlanner();
  const current = completeBackupState(planner);
  const { analytics, ...withoutAnalytics } = current;
  const { theme, ...legacySettings } = withoutAnalytics.settings;
  const legacyState = { ...withoutAnalytics, settings: legacySettings };

  assert.deepEqual(planner.parseBackup(`TimeSprout backup v1\n${JSON.stringify(legacyState)}`), {
    ok: true,
    state: planner.normalizeState(legacyState)
  });
});

test('v2 backup round trips a theme and daily aggregates', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({
    settings: { language: 'en', theme: 'dark' },
    analytics: { daily: { '2030-01-02': { completedTaskCount: 2, completedTaskMinutes: 75, focusSeconds: 1500 } } }
  });
  const text = planner.serializeBackup(state);

  assert.match(text, /^TimeSprout backup v2\n/);
  assert.deepEqual(planner.parseBackup(text), { ok: true, state });
});

test('v2 backup preserves a navigation layout and rejects an invalid explicit layout', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({
    settings: { language: 'en', theme: 'dark', navigationLayout: 'sidebar' },
    analytics: { daily: {} }
  });
  const invalid = { ...state, settings: { ...state.settings, navigationLayout: 'floating' } };

  assert.equal(planner.parseBackup(planner.serializeBackup(state)).state.settings.navigationLayout, 'sidebar');
  assert.deepEqual(planner.parseBackup(`TimeSprout backup v2\n${JSON.stringify(invalid)}`), { ok: false, error: 'invalid-state' });
});

test('v2 backup rejects malformed analytics without normalizing it away', () => {
  const planner = loadPlanner();
  const text = 'TimeSprout backup v2\n' + JSON.stringify({
    courses: [], tasks: [], events: [], holidays: [], history: [], settings: { theme: 'system' }, focus: {},
    analytics: { daily: { 'not-a-date': { completedTaskCount: -1, completedTaskMinutes: 0, focusSeconds: 0 } } }
  });

  assert.deepEqual(planner.parseBackup(text), { ok: false, error: 'invalid-state' });
});

test('v2 backup rejects an undo snapshot with an unrecognized theme', () => {
  const planner = loadPlanner();
  const source = completeBackupState(planner);
  const text = 'TimeSprout backup v2\n' + JSON.stringify({
    ...source,
    undo: { ...source.undo, state: { ...source.undo.state, settings: { ...source.undo.state.settings, theme: 'neon' } } }
  });

  assert.deepEqual(planner.parseBackup(text), { ok: false, error: 'invalid-state' });
});

test('v2 backup rejects an undo snapshot with an invalid navigation layout', () => {
  const planner = loadPlanner();
  const source = completeBackupState(planner);
  const text = 'TimeSprout backup v2\n' + JSON.stringify({
    ...source,
    undo: { ...source.undo, state: { ...source.undo.state, settings: { ...source.undo.state.settings, navigationLayout: 'floating' } } }
  });

  assert.deepEqual(planner.parseBackup(text), { ok: false, error: 'invalid-state' });
});

test('v2 backup rejects an undo snapshot with malformed analytics', () => {
  const planner = loadPlanner();
  const source = completeBackupState(planner);
  const text = 'TimeSprout backup v2\n' + JSON.stringify({
    ...source,
    undo: { ...source.undo, state: { ...source.undo.state, analytics: { daily: { 'bad-date': { completedTaskCount: 0, completedTaskMinutes: 0, focusSeconds: 0 } } } } }
  });

  assert.deepEqual(planner.parseBackup(text), { ok: false, error: 'invalid-state' });
});

test('backup parser accepts a UTF-8 BOM and rejects bad headers, versions, and bodies', () => {
  const planner = loadPlanner();
  const text = planner.serializeBackup(completeBackupState(planner));

  assert.equal(planner.parseBackup(`\uFEFF${text}`).ok, true);
  assert.deepEqual(planner.parseBackup('not a TimeSprout backup'), { ok: false, error: 'invalid-format' });
  assert.deepEqual(planner.parseBackup('TimeSprout backup v3\n{}'), { ok: false, error: 'unsupported-version' });
  assert.deepEqual(planner.parseBackup('TimeSprout backup v1\n{'), { ok: false, error: 'invalid-state' });
  assert.deepEqual(planner.parseBackup('TimeSprout backup v1\n[]'), { ok: false, error: 'invalid-state' });
});

test('backup parser rejects empty and malformed raw state shapes before normalization', () => {
  const planner = loadPlanner();
  const header = 'TimeSprout backup v1\n';

  assert.deepEqual(planner.parseBackup(`${header}{}`), { ok: false, error: 'invalid-state' });
  assert.deepEqual(planner.parseBackup(`${header}{"courses":{},"tasks":[],"events":[],"holidays":[],"settings":{},"focus":{}}`), { ok: false, error: 'invalid-state' });
  assert.deepEqual(planner.parseBackup(`${header}{"courses":[],"tasks":[],"events":[],"holidays":[],"settings":{},"focus":{},"undo":{"reason":"bad","state":{}}}`), { ok: false, error: 'invalid-state' });
  assert.deepEqual(planner.parseBackup(`${header}{"courses":[],"tasks":[],"events":[],"holidays":[],"settings":{},"focus":{},"history":{}}`), { ok: false, error: 'invalid-state' });
  assert.deepEqual(planner.parseBackup(`${header}{"courses":[],"tasks":[],"events":[],"holidays":[],"settings":{},"focus":{},"history":[],"undo":{"reason":"bad","state":{"courses":[],"tasks":[],"events":[],"holidays":[],"settings":{},"focus":{},"history":{}}}}`), { ok: false, error: 'invalid-state' });
  assert.deepEqual(planner.parseBackup(`${header}{"courses":[],"tasks":[{"id":"missing-duration","title":"任务"}],"events":[],"holidays":[],"settings":{},"focus":{},"history":[]}`), { ok: false, error: 'invalid-state' });
});

test('backup parser rejects unsafe identifiers and invalid holiday fields', () => {
  const planner = loadPlanner();
  const source = completeBackupState(planner);
  const header = 'TimeSprout backup v1\n';

  assert.deepEqual(
    planner.parseBackup(`${header}${JSON.stringify({ ...source, courses: [{ ...source.courses[0], id: 'course" onmouseover="alert(1)' }] })}`),
    { ok: false, error: 'invalid-state' }
  );
  assert.deepEqual(
    planner.parseBackup(`${header}${JSON.stringify({ ...source, holidays: [{ ...source.holidays[0], start: '"><script>', end: '2030-10-07' }] })}`),
    { ok: false, error: 'invalid-state' }
  );
  assert.deepEqual(
    planner.parseBackup(`${header}${JSON.stringify({ ...source, holidays: [{ ...source.holidays[0], minutes: 999 }] })}`),
    { ok: false, error: 'invalid-state' }
  );
});

test('overnight fixed conflicts are evaluated on the planning date', () => {
  const planner = loadPlanner({
    courses: [{ id: 'course-overnight', title: 'Night class', day: 2, start: '00:30', end: '01:00', location: '' }],
    events: [{ id: 'event-overnight', title: 'Night event', start: '2030-08-27T00:45:00', end: '2030-08-27T01:15:00', kind: 'event' }],
    settings: { wake: '07:00', sleep: '01:00', play: 0, language: 'zh-CN' }
  });

  assert.deepEqual(
    planner.findFixedConflicts(planner.fixedBlocks('2030-08-26')),
    [{ firstId: 'course-overnight', secondId: 'event-overnight' }]
  );
});

test('backup summary reports each plan collection count', () => {
  const planner = loadPlanner();

  assert.deepEqual(planner.backupSummary({
    courses: [{ id: 'course' }], tasks: [{ id: 'task-1' }, { id: 'task-2' }],
    events: [{ id: 'event' }], holidays: [{ id: 'holiday-1' }, { id: 'holiday-2' }]
  }), { courses: 1, tasks: 2, events: 1, holidays: 2 });
});

test('backup file selection stages a valid import without replacing the current plan', () => {
  const planner = loadPlanner();
  const current = completeBackupState(planner);
  const backupText = planner.serializeBackup(planner.normalizeState({
    ...current,
    tasks: [...current.tasks, { id: 'imported-task', title: 'Imported task', duration: 30, due: '2030-08-27T20:00:00', priority: 'medium', status: 'pending' }]
  }));
  const harness = interactionHarness(current);

  harness.changeBackupFile({ name: 'timesprout-backup.txt', size: Buffer.byteLength(backupText), text: backupText });
  assert.equal(harness.savedWrites.length, 0);
  assert.match(harness.markup, /Backup read\. Waiting for import confirmation\./);

  harness.changeBackupFile({ name: 'broken-backup.txt', size: 8, text: 'not txt!' });
  assert.equal(harness.savedWrites.length, 0);
  assert.match(harness.markup, /Backup file is invalid\. Your current plan was not changed\./);
});

test('reset settings and clear plan preserve exactly their documented state ranges', () => {
  const planner = loadPlanner();
  const state = completeBackupState(planner);
  const reset = planner.resetSettingsState(state);
  const cleared = planner.clearPlanState(state);

  assert.deepEqual(reset.settings, { wake: '07:00', sleep: '22:30', play: 60, language: 'en', theme: 'system', navigationLayout: 'top' });
  assert.deepEqual(reset.focus, { taskId: '', mode: 'focus', running: false, remainingSeconds: 1500, startedAt: '', completedPomodoros: 0, totalSeconds: 0, lastTick: 0 });
  assert.deepEqual(reset.courses, state.courses);
  assert.deepEqual(reset.tasks, state.tasks);
  assert.deepEqual(reset.events, state.events);
  assert.deepEqual(reset.holidays, state.holidays);
  assert.deepEqual(reset.history, state.history);
  assert.equal(reset.undo, null);

  assert.deepEqual(cleared.settings, state.settings);
  assert.deepEqual(cleared.focus, { taskId: '', mode: 'focus', running: false, remainingSeconds: 1500, startedAt: '', completedPomodoros: 0, totalSeconds: 0, lastTick: 0 });
  assert.deepEqual(cleared.courses, []);
  assert.deepEqual(cleared.tasks, []);
  assert.deepEqual(cleared.events, []);
  assert.deepEqual(cleared.holidays, []);
  assert.deepEqual(cleared.history, []);
  assert.equal(cleared.undo, null);
});

test('danger confirmations advance only after two matching actions', () => {
  const planner = loadPlanner();

  assert.deepEqual(planner.advanceDangerConfirmation(null, 'clear-plan'), { action: 'clear-plan', stage: 1 });
  assert.deepEqual(planner.advanceDangerConfirmation({ action: 'clear-plan', stage: 1 }, 'clear-plan'), { action: 'clear-plan', stage: 2 });
  assert.equal(planner.advanceDangerConfirmation({ action: 'clear-plan', stage: 1 }, 'cancel'), null);
  assert.equal(planner.advanceDangerConfirmation({ action: 'clear-plan', stage: 1 }, 'reset-settings'), null);
});

test('destructive settings controls stage before save and execute only on a matching second confirmation', () => {
  const planner = loadPlanner();
  const current = completeBackupState(planner);

  for (const [command, expected] of [
    ['reset-settings', state => state.settings],
    ['clear-plan', state => state.tasks]
  ]) {
    const harness = interactionHarness(current);
    harness.selectTab('settings');
    harness.pressCommand(command);
    assert.equal(harness.savedWrites.length, 0, `${command} must not save at stage one`);
    assert.match(harness.markup, /data-danger-confirmation/, `${command} must render the page-local confirmation panel`);
    assert.equal((harness.markup.match(/data-danger-confirmation/g) || []).length, 1, `${command} must render exactly one confirmation panel`);
    if (command === 'reset-settings') assert.match(harness.markup, /value="06:30"/, 'stage one must leave routine state unchanged');
    else assert.match(harness.markup, /Add task/, 'stage one must leave plan history unchanged');

    harness.pressCommand(command);
    assert.equal(harness.savedWrites.length, 1, `${command} must save once after stage two`);
    const saved = JSON.parse(harness.savedWrites[0].value);
    if (command === 'reset-settings') assert.deepEqual(expected(saved), { wake: '07:00', sleep: '22:30', play: 60, language: 'en', theme: 'system', navigationLayout: 'top' });
    else assert.deepEqual(expected(saved), []);
  }
});

test('cancel, tab navigation, and a successful unrelated submission clear staged destructive confirmation', () => {
  const planner = loadPlanner();
  const current = completeBackupState(planner);
  const harness = interactionHarness(current);
  harness.selectTab('settings');
  harness.pressCommand('clear-plan');
  harness.pressCommand('danger-cancel');
  assert.equal(harness.savedWrites.length, 0);
  assert.doesNotMatch(harness.markup, /data-danger-confirmation/);
  assert.match(harness.markup, /Add task/, 'cancel must preserve plan records');

  harness.pressCommand('clear-plan');
  harness.selectTab('today');
  harness.selectTab('settings');
  harness.pressCommand('clear-plan');
  assert.equal(harness.savedWrites.length, 0, 'navigation must make the next click stage one again');

  harness.submitForm('course', { title: 'Physics', day: '1', start: '08:00', end: '09:00', location: '' });
  const writesAfterCourse = harness.savedWrites.length;
  harness.pressCommand('clear-plan');
  assert.equal(harness.savedWrites.length, writesAfterCourse, 'a successful unrelated submission must clear the staged action');
});

test('confirmed import replaces every plan collection without mutating the original input', () => {
  const planner = loadPlanner();
  const current = completeBackupState(planner);
  const originalCurrent = structuredClone(current);
  const imported = planner.normalizeState({
    ...current,
    courses: [{ id: 'imported-course', title: 'Imported course', day: 3, start: '09:00', end: '10:00', location: 'A-101' }],
    tasks: [{ id: 'imported-task', title: 'Imported task', duration: 30, due: '2030-08-27T20:00:00', priority: 'medium', status: 'pending' }],
    events: [{ id: 'imported-event', title: 'Imported event', start: '2030-08-27T13:00:00', end: '2030-08-27T14:00:00', kind: 'event' }],
    holidays: [{ id: 'imported-holiday', title: 'Imported holiday', start: '2030-10-01', end: '2030-10-07', minutes: 60, notes: 'Imported notes' }],
    history: [], undo: null
  });
  const harness = interactionHarness(current);
  harness.selectTab('settings');
  const backupText = planner.serializeBackup(imported);
  harness.changeBackupFile({ name: 'timesprout-backup.txt', size: Buffer.byteLength(backupText), text: backupText });
  harness.pressCommand('import-replace');
  assert.equal(harness.savedWrites.length, 0, 'import stage one must neither replace nor save');
  assert.match(harness.markup, /Backup contents — Courses: 1 · Tasks: 1 · Events: 1 · Breaks: 1/, 'the staged import confirmation must show every imported collection count');

  harness.pressCommand('import-replace');
  assert.equal(harness.savedWrites.length, 1);
  const saved = JSON.parse(harness.savedWrites[0].value);
  assert.deepEqual(
    Object.fromEntries(['courses', 'tasks', 'events', 'holidays'].map(key => [key, saved[key].map(record => record.id)])),
    { courses: ['imported-course'], tasks: ['imported-task'], events: ['imported-event'], holidays: ['imported-holiday'] }
  );
  assert.deepEqual(current, originalCurrent, 'importing must not mutate the caller\'s original plan input');
});

test('overdue queue orders the longest-overdue tasks before priority ties', () => {
  const planner = loadPlanner();
  const now = '2030-01-10T12:00:00';
  const tasks = [
    { id: 'recent-high', title: 'Recent high', due: '2030-01-09T12:00:00', priority: 'high', status: 'pending' },
    { id: 'old-low', title: 'Old low', due: '2030-01-01T12:00:00', priority: 'low', status: 'pending' },
    { id: 'old-high', title: 'Old high', due: '2030-01-01T12:00:00', priority: 'high', status: 'pending' },
    { id: 'complete', title: 'Complete', due: '2030-01-01T12:00:00', priority: 'high', status: 'completed', completed: true }
  ];

  assert.deepEqual(planner.sortOverdueTasks(tasks, now).map(task => task.id), ['old-high', 'old-low', 'recent-high']);
});

test('today view renders the overdue queue in its priority order', () => {
  const harness = interactionHarness({
    settings: { wake: '07:00', sleep: '22:30', play: 0, language: 'en' },
    tasks: [
      { id: 'recent-high', title: 'Recent high', duration: 30, due: '2020-01-09T12:00:00', priority: 'high', status: 'pending' },
      { id: 'old-low', title: 'Old low', duration: 30, due: '2020-01-01T12:00:00', priority: 'low', status: 'pending' },
      { id: 'old-high', title: 'Old high', duration: 30, due: '2020-01-01T12:00:00', priority: 'high', status: 'pending' }
    ]
  });

  const queue = harness.markup.match(/data-overdue-queue[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(queue.indexOf('Old high') < queue.indexOf('Old low'));
  assert.ok(queue.indexOf('Old low') < queue.indexOf('Recent high'));
});

test('overdue command reassigns past calendar tasks into the current planning day', () => {
  const today = localDateTime(new Date()).slice(0, 10);
  const harness = interactionHarness({
    settings: { wake: '07:00', sleep: '22:30', play: 0, language: 'en' },
    tasks: [{ id: 'past-calendar-task', title: 'Past calendar task', duration: 30, date: '2020-01-02', due: '2020-01-02T22:30:00', priority: 'high', status: 'pending' }]
  });

  harness.pressCommand('overdue');

  const saved = JSON.parse(harness.savedWrites.at(-1).value);
  assert.deepEqual(saved.tasks[0], {
    id: 'past-calendar-task', title: 'Past calendar task', duration: 30,
    date: today, due: `${today}T22:30:00`, priority: 'high', status: 'pending'
  });
  assert.equal(saved.history.at(-1).reason, '处理逾期任务');
});

test('focus controls refuse a completed task left over from an earlier session', () => {
  const harness = interactionHarness({
    settings: { language: 'en' },
    tasks: [{ id: 'completed-task', title: 'Completed task', duration: 30, status: 'completed', completed: true }],
    focus: { taskId: 'completed-task', mode: 'focus', running: false, remainingSeconds: 1500, startedAt: '', completedPomodoros: 0, totalSeconds: 0, lastTick: 0 }
  });

  harness.selectTab('focus');
  harness.pressCommand('focus-toggle');

  const saved = JSON.parse(harness.savedWrites.at(-1).value);
  assert.deepEqual(saved.focus, { taskId: '', mode: 'focus', running: false, remainingSeconds: 1500, startedAt: '', completedPomodoros: 0, totalSeconds: 0, lastTick: 0 });
  assert.match(harness.markup, /No pending tasks/);
  assert.doesNotMatch(harness.markup, />Pause</);
});

test('calendar translates system-created one-time breaks without translating user events', () => {
  const today = localDateTime(new Date()).slice(0, 10);
  const harness = interactionHarness({
    settings: { language: 'en' },
    events: [
      { id: 'one-time-break', title: '任务完成后休息 · 5 分钟', start: `${today}T10:00:00`, end: `${today}T10:05:00`, kind: 'locked', oneTimeBreak: true },
      { id: 'user-event', title: '任务完成后休息 · 5 分钟', start: `${today}T11:00:00`, end: `${today}T11:05:00`, kind: 'event' }
    ]
  });

  harness.selectTab('calendar');

  assert.match(harness.markup, /Break after task completion · 5 min/);
  assert.match(harness.markup, /任务完成后休息 · 5 分钟/);
});

test('holiday form explains why an end date before the start date is rejected', () => {
  const harness = interactionHarness({ settings: { language: 'en' } });

  harness.selectTab('holiday');
  const event = harness.submitForm('holiday', {
    title: 'Autumn break', start: '2030-10-10', end: '2030-10-01', minutes: '90', notes: ''
  });

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.immediatePropagationStopped, true);
  assert.equal(harness.savedWrites.length, 0);
  assert.match(harness.markup, /Break end date must not be earlier than its start date\./);
});

test('malformed holiday data from local storage is discarded before it can reach the page', () => {
  const payload = '"><script>alert(1)</script>';
  const harness = interactionHarness({
    settings: { language: 'en' },
    holidays: [{ id: 'malformed-holiday', title: 'Malformed holiday', start: payload, end: '2030-10-07', minutes: 90, notes: '' }]
  });

  harness.selectTab('holiday');

  assert.doesNotMatch(harness.markup, /<script>alert\(1\)<\/script>/);
  assert.match(harness.markup, /No break plans yet/);
});

test('weekly course data groups lessons by weekday, time, and conflict state', () => {
  const planner = loadPlanner();
  const week = planner.buildCourseWeek([
    { id: 'later', title: 'Later', day: 1, start: '10:00', end: '11:00', location: '' },
    { id: 'overlap', title: 'Overlap', day: 1, start: '08:30', end: '09:30', location: '' },
    { id: 'early', title: 'Early', day: 1, start: '08:00', end: '09:00', location: '' },
    { id: 'other-day', title: 'Other day', day: 3, start: '09:00', end: '10:00', location: '' }
  ]);

  assert.deepEqual(week[1].courses.map(course => [course.id, course.conflicted]), [['early', true], ['overlap', true], ['later', false]]);
  assert.deepEqual(week[3].courses.map(course => course.id), ['other-day']);
  assert.deepEqual(week[0].courses, []);
});

test('quadrant buckets put overdue tasks first and retain a deterministic priority order', () => {
  const planner = loadPlanner();
  const buckets = planner.quadrantBuckets([
    { id: 'future-high', title: 'Future high', due: '2030-01-11T12:00:00', priority: 'high', important: true, urgent: true, status: 'pending' },
    { id: 'old-low', title: 'Old low', due: '2030-01-01T12:00:00', priority: 'low', important: true, urgent: true, status: 'pending' },
    { id: 'old-high', title: 'Old high', due: '2030-01-01T12:00:00', priority: 'high', important: true, urgent: true, status: 'pending' },
    { id: 'planned', title: 'Planned', due: '2030-01-02T12:00:00', priority: 'medium', important: true, urgent: false, status: 'pending' },
    { id: 'skipped', title: 'Skipped', due: '2030-01-01T12:00:00', priority: 'high', important: true, urgent: true, status: 'skipped' }
  ], '2030-01-10T12:00:00');

  assert.deepEqual(buckets.do.map(task => task.id), ['old-high', 'old-low', 'future-high']);
  assert.deepEqual(buckets.plan.map(task => task.id), ['planned']);
  assert.deepEqual(buckets.delegate, []);
  assert.deepEqual(buckets.eliminate, []);
});

test('task completion records its duration once on the overnight planning date', () => {
  const planner = loadPlanner();
  const source = planner.normalizeState({
    settings: { wake: '20:00', sleep: '06:00' },
    tasks: [{ id: 'task-a', title: 'Write', duration: 45, due: '2030-01-02T05:00:00', status: 'pending' }]
  });

  const once = planner.completeTaskState(source, 'task-a', '2030-01-02T01:00:00');
  const twice = planner.completeTaskState(once, 'task-a', '2030-01-02T01:01:00');

  assert.deepEqual(source.analytics, { daily: {} }, 'the reducer must not mutate its input');
  assert.equal(twice.tasks[0].status, 'completed');
  assert.deepEqual(twice.analytics.daily['2030-01-01'], {
    completedTaskCount: 1, completedTaskMinutes: 45, focusSeconds: 0
  });
});

test('leisure-only completion preserves task status without creating completion or streak metrics', () => {
  const planner = loadPlanner();
  const source = planner.normalizeState({
    tasks: [{ id: 'leisure-task', title: 'Walk', duration: 30, due: '2030-01-10T20:00:00', leisure: true, status: 'pending' }]
  });

  const completed = planner.completeTaskState(source, 'leisure-task', '2030-01-10T12:00:00');
  const summary = planner.analyticsSummary(completed, '2030-01-10T12:00:00', 7);

  assert.equal(completed.tasks[0].status, 'completed');
  assert.equal(completed.tasks[0].completed, true);
  assert.deepEqual(completed.analytics, { daily: {} });
  assert.equal(summary.completedTasks, 0);
  assert.equal(summary.streakDays, 0);
  assert.equal(summary.taskTrend.at(-1).value, 0);
});

test('completed focus rounds record exactly one pomodoro on the planning date', () => {
  const planner = loadPlanner();
  const source = planner.normalizeState({
    settings: { wake: '20:00', sleep: '06:00' },
    focus: { running: true, mode: 'focus', remainingSeconds: 1, lastTick: Date.parse('2030-01-02T00:59:59') }
  });

  const completed = planner.tickFocusState(source, Date.parse('2030-01-02T01:00:00')).state;
  const breakTick = planner.tickFocusState(completed, Date.parse('2030-01-02T01:00:01')).state;

  assert.deepEqual(completed.analytics.daily['2030-01-01'], {
    completedTaskCount: 0, completedTaskMinutes: 0, focusSeconds: 1500
  });
  assert.deepEqual(breakTick.analytics.daily['2030-01-01'], completed.analytics.daily['2030-01-01']);
});

test('analytics summary uses inclusive 7 and 30 day boundaries, live overdue work, and streak interruptions', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({
    analytics: { daily: {
      '2030-01-04': { completedTaskCount: 1, completedTaskMinutes: 20, focusSeconds: 0 },
      '2030-01-08': { completedTaskCount: 1, completedTaskMinutes: 30, focusSeconds: 0 },
      '2030-01-10': { completedTaskCount: 0, completedTaskMinutes: 0, focusSeconds: 1500 }
    } },
    tasks: [
      { id: 'within-seven', title: 'Within seven', duration: 20, due: '2030-01-04T20:00:00', status: 'completed', completed: true },
      { id: 'older', title: 'Older', duration: 20, due: '2029-12-20T20:00:00', status: 'completed', completed: true },
      { id: 'late', title: 'Late', duration: 20, due: '2030-01-09T20:00:00', status: 'pending' },
      { id: 'skipped', title: 'Skipped', duration: 20, due: '2030-01-09T20:00:00', status: 'skipped' },
      { id: 'leisure', title: 'Leisure', duration: 20, due: '2030-01-09T20:00:00', leisure: true, status: 'completed', completed: true }
    ]
  });

  const seven = planner.analyticsSummary(state, '2030-01-10T12:00:00', 7);
  const thirty = planner.analyticsSummary(state, '2030-01-10T12:00:00', 30);

  assert.equal(seven.days, 7);
  assert.equal(seven.completedTasks, 1);
  assert.equal(seven.eligibleTasks, 2);
  assert.equal(seven.completionRate, 0.5);
  assert.equal(seven.focusSeconds, 1500);
  assert.equal(seven.overdueCount, 1);
  assert.equal(seven.streakDays, 1, 'a zero-data day interrupts the current streak');
  assert.equal(seven.taskTrend.length, 7);
  assert.deepEqual(seven.taskTrend[0], { date: '2030-01-04', value: 1 });
  assert.equal(thirty.eligibleTasks, 3, 'the 30-day range includes the older task');
});

test('completion rate counts only completed members of the selected non-leisure due cohort', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({
    analytics: { daily: { '2030-01-09': { completedTaskCount: 99, completedTaskMinutes: 990, focusSeconds: 0 } } },
    tasks: [
      { id: 'early-future', title: 'Early future', duration: 30, due: '2030-01-08T20:00:00', status: 'completed', completed: true, completedAt: '2030-01-01T10:00:00' },
      { id: 'open-cohort', title: 'Open cohort', duration: 30, due: '2030-01-09T20:00:00', status: 'pending' },
      { id: 'old-overdue', title: 'Old overdue', duration: 30, due: '2030-01-03T20:00:00', status: 'completed', completed: true, completedAt: '2030-01-09T10:00:00' },
      { id: 'leisure', title: 'Leisure', duration: 30, due: '2030-01-09T20:00:00', leisure: true, status: 'completed', completed: true }
    ]
  });

  const summary = planner.analyticsSummary(state, '2030-01-10T12:00:00', 7);

  assert.equal(summary.eligibleTasks, 2);
  assert.equal(summary.completedTasks, 1);
  assert.equal(summary.completionRate, 0.5);
});

test('analytics streak continues before the selected reporting range until a missing day interrupts it', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({
    analytics: { daily: Object.fromEntries([
      '2030-01-03', '2030-01-04', '2030-01-05', '2030-01-06',
      '2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10'
    ].map(date => [date, { completedTaskCount: 1, completedTaskMinutes: 30, focusSeconds: 0 }])) }
  });

  assert.equal(planner.analyticsSummary(state, '2030-01-10T12:00:00', 7).streakDays, 8);
});

test('analytics allocation groups scheduled and fixed blocks into stable minute categories', () => {
  const planner = loadPlanner();
  const state = planner.normalizeState({
    settings: { wake: '08:00', sleep: '12:00', play: 30 },
    courses: [{ id: 'course', title: 'Course', day: 3, start: '09:00', end: '10:00' }],
    events: [{ id: 'event', title: 'Event', start: '2030-01-02T10:00:00', end: '2030-01-02T10:30:00', kind: 'event' }],
    tasks: [{ id: 'task', title: 'Task', duration: 60, due: '2030-01-02T12:00:00', status: 'pending' }]
  });

  assert.deepEqual(planner.analyticsAllocation(state, '2030-01-02', '2030-01-02T08:00:00'), {
    courses: 60, events: 30, tasks: 60, leisure: 30
  });
});

