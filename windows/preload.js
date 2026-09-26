'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('TimeSproutNative', {
  syncReminders(json) { return ipcRenderer.invoke('timesprout:reminders', json); },
  exportBackup(filename, content) { return ipcRenderer.invoke('timesprout:backup', filename, content); }
});
