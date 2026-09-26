'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeReminders, shouldDeliverReminder } = require('./reminder-store');

const APP_ID = 'top.dffapi.timesprout';
let window;
let tray;
let quitting = false;
let reminders = [];
let delivered = new Set();
let lastSyncDay = '';
let lastSyncClock = '';

function statePath() { return path.join(app.getPath('userData'), 'native-reminders.json'); }
function persist() {
  try { fs.writeFileSync(statePath(), JSON.stringify({ reminders, delivered: [...delivered] }), 'utf8'); return true; }
  catch (error) { console.error('Could not save reminders', error); return false; }
}
function restore() {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    reminders = normalizeReminders(saved.reminders, Date.now(), true);
    delivered = new Set(Array.isArray(saved.delivered) ? saved.delivered.filter(id => typeof id === 'string') : []);
  } catch { reminders = []; delivered = new Set(); }
}
function showWindow() { if (window) { window.show(); window.focus(); } }
function dispatchReminders() {
  const now = Date.now();
  let changed = false;
  for (const item of reminders) {
    if (item.at > now || delivered.has(item.id)) continue;
    delivered.add(item.id);
    changed = true;
    if (!shouldDeliverReminder(item, now)) continue;
    if (Notification.isSupported()) {
      const notice = new Notification({ title: item.title, body: item.body, silent: false, id: item.id });
      notice.on('click', showWindow);
      notice.show();
    }
  }
  if (changed) persist();
  const current = new Date();
  const day = current.toDateString();
  const clock = `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}-${current.getHours()}-${current.getMinutes()}-${current.getTimezoneOffset()}`;
  if (day !== lastSyncDay || clock !== lastSyncClock) {
    lastSyncDay = day;
    lastSyncClock = clock;
    window?.webContents.executeJavaScript('globalThis.TimeSproutSyncNativeReminders?.()').catch(() => {});
  }
}
function makeWindow() {
  window = new BrowserWindow({
    width: 1220, height: 840, minWidth: 360, minHeight: 520, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.loadFile(path.join(__dirname, '..', 'index.html'));
  window.once('ready-to-show', () => window.show());
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
}
function makeTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('TimeSprout');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 TimeSprout', click: showWindow },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', showWindow);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    restore();
    makeWindow();
    makeTray();
    ipcMain.handle('timesprout:reminders', (event, json) => {
      if (event.sender !== window?.webContents || typeof json !== 'string') return false;
      try {
        const nextReminders = normalizeReminders(JSON.parse(json));
        const liveIds = new Set(nextReminders.map(item => item.id));
        const previousReminders = reminders;
        const previousDelivered = delivered;
        reminders = nextReminders;
        delivered = new Set([...delivered].filter(id => liveIds.has(id)));
        if (!persist()) { reminders = previousReminders; delivered = previousDelivered; return false; }
        return true;
      } catch (error) { console.error('Invalid reminder data', error); return false; }
    });
    ipcMain.handle('timesprout:backup', async (event, filename, content) => {
      if (event.sender !== window?.webContents || typeof filename !== 'string' || typeof content !== 'string' || content.length > 10000000) return false;
      const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(filename), filters: [{ name: 'Text backup', extensions: ['txt'] }] });
      if (result.canceled || !result.filePath) return false;
      await fs.promises.writeFile(result.filePath, content, 'utf8');
      return true;
    });
    setInterval(dispatchReminders, 15000).unref();
    dispatchReminders();
  });
  app.on('window-all-closed', () => {});
}
