'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Store } = require('./store');

const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets');
const isDev = process.argv.includes('--dev');

let mainWindow = null;
let store = null;
let logoDataUrl = '';

function buildLogo() {
  try {
    // logo-mark.png est la version detouree (fond transparent) : lisible
    // aussi bien en theme clair que sur le blanc du rapport imprime.
    const candidates = ['logo-mark.png', 'Logo.png'];
    for (const name of candidates) {
      const file = path.join(ASSETS, name);
      if (!fs.existsSync(file)) continue;
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) continue;
      return img.resize({ width: 256, height: 256, quality: 'best' }).toDataURL();
    }
    return '';
  } catch (_) {
    return '';
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1060,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#0d111b',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  const pushState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:state', { maximized: mainWindow.isMaximized() });
    }
  };
  mainWindow.on('maximize', pushState);
  mainWindow.on('unmaximize', pushState);
  mainWindow.on('closed', () => { mainWindow = null; });

  // Les liens externes s'ouvrent dans le navigateur, jamais dans l'app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  logoDataUrl = buildLogo();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------------------------------------------------------- IPC : donnees */

ipcMain.handle('store:read', () => store.read());

ipcMain.handle('store:write', (_e, data) => {
  store.write(data);
  return true;
});

ipcMain.handle('store:snapshot', () => store.snapshot());

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  dataFile: store.file,
  backupDir: store.backupDir,
  logo: logoDataUrl,
  platform: process.platform,
  electron: process.versions.electron
}));

ipcMain.handle('app:revealData', () => {
  if (fs.existsSync(store.file)) shell.showItemInFolder(store.file);
  else shell.openPath(store.dir);
  return true;
});

/* ---------------------------------------------------------------- IPC : fenetre */

ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:toggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());

/* ---------------------------------------------------------------- IPC : export */

ipcMain.handle('export:backup', async (_e, data) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter les donnees DonTrack',
    defaultPath: path.join(app.getPath('documents'), `dontrack-sauvegarde-${stamp}.json`),
    filters: [{ name: 'Sauvegarde JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf8');
  return { canceled: false, path: res.filePath };
});

ipcMain.handle('import:backup', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Importer une sauvegarde DonTrack',
    properties: ['openFile'],
    filters: [{ name: 'Sauvegarde JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  const raw = fs.readFileSync(res.filePaths[0], 'utf8');
  const parsed = JSON.parse(raw);
  return { canceled: false, data: store.migrate(parsed), path: res.filePaths[0] };
});

ipcMain.handle('export:csv', async (_e, { csv, suggestedName }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter en CSV',
    defaultPath: path.join(app.getPath('documents'), suggestedName || 'dontrack.csv'),
    filters: [{ name: 'Fichier CSV', extensions: ['csv'] }]
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  // BOM UTF-8 : Excel affiche correctement les accents.
  fs.writeFileSync(res.filePath, '﻿' + csv, 'utf8');
  return { canceled: false, path: res.filePath };
});

/* ---------------------------------------------------------------- IPC : rapport PDF */

ipcMain.handle('report:pdf', async (_e, { html, suggestedName, landscape }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Enregistrer le rapport',
    defaultPath: path.join(app.getPath('documents'), suggestedName || 'rapport-dontrack.pdf'),
    filters: [{ name: 'Document PDF', extensions: ['pdf'] }]
  });
  if (res.canceled || !res.filePath) return { canceled: true };

  const tmpFile = path.join(os.tmpdir(), `dontrack-rapport-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf8');

  const worker = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: true, contextIsolation: true }
  });

  try {
    await worker.loadFile(tmpFile);
    await worker.webContents.executeJavaScript(
      'new Promise(r => { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(() => r(true))); else r(true); })'
    );
    const pdf = await worker.webContents.printToPDF({
      pageSize: 'A4',
      landscape: !!landscape,
      printBackground: true,
      margins: { top: 0.55, bottom: 0.5, left: 0.5, right: 0.5 },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#79839a;font-family:Segoe UI,sans-serif;' +
        'padding:0 13mm;display:flex;justify-content:space-between;">' +
        '<span>DonTrack</span><span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
    });
    fs.writeFileSync(res.filePath, pdf);
    return { canceled: false, path: res.filePath };
  } catch (err) {
    return { canceled: false, error: String(err && err.message ? err.message : err) };
  } finally {
    worker.destroy();
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
  }
});

ipcMain.handle('shell:open', async (_e, target) => {
  const err = await shell.openPath(target);
  return !err;
});

ipcMain.handle('dialog:confirm', async (_e, { title, message, detail, confirmLabel, danger }) => {
  const res = await dialog.showMessageBox(mainWindow, {
    type: danger ? 'warning' : 'question',
    buttons: [confirmLabel || 'Confirmer', 'Annuler'],
    defaultId: 0,
    cancelId: 1,
    title: title || 'DonTrack',
    message: message || '',
    detail: detail || '',
    noLink: true
  });
  return res.response === 0;
});
