'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/** Surface minimale exposee au renderer : aucune API Node directe. */
contextBridge.exposeInMainWorld('dontrack', {
  read: () => ipcRenderer.invoke('store:read'),
  write: (data) => ipcRenderer.invoke('store:write', data),
  snapshot: () => ipcRenderer.invoke('store:snapshot'),
  info: () => ipcRenderer.invoke('app:info'),
  revealData: () => ipcRenderer.invoke('app:revealData'),

  exportBackup: (data) => ipcRenderer.invoke('export:backup', data),
  importBackup: () => ipcRenderer.invoke('import:backup'),
  exportCsv: (payload) => ipcRenderer.invoke('export:csv', payload),
  generatePdf: (payload) => ipcRenderer.invoke('report:pdf', payload),
  openPath: (target) => ipcRenderer.invoke('shell:open', target),
  confirm: (payload) => ipcRenderer.invoke('dialog:confirm', payload),

  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle'),
  close: () => ipcRenderer.send('window:close'),
  onWindowState: (cb) => ipcRenderer.on('window:state', (_e, state) => cb(state))
});
