import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import fs from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let port; // active SerialPort
let parser; // line parser for responses
const queue = []; // gcode command queue
let busy = false;

function isDev() {
  return process.env.NODE_ENV !== 'production';
}
function devUrl() {
  return process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
    }
  });

  try {
    if (isDev()) {
      await mainWindow.loadURL(devUrl());
    } else {
      // await mainWindow.loadFile(path.join(process.cwd(), 'dist', 'index.html'));
      await mainWindow.loadFile(path.join('index.html'));
    }
  } catch (err) {
    console.error('Failed to load UI:', err);
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    console.error(`did-fail-load code=${code} desc=${desc} url=${url} main=${isMainFrame}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('render-process-gone:', details);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function listPorts() { return SerialPort.list(); }

function openPort({ path, baudRate = 115200 }) {
  return new Promise((resolve, reject) => {
    if (port && port.isOpen) port.close(() => { });
    port = new SerialPort({ path, baudRate }, (err) => {
      if (err) return reject(err);
      parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', onLine);
      resolve();
    });
  });
}

function closePort() {
  return new Promise((resolve) => {
    if (!port) return resolve();
    port.close(() => resolve());
  });
}

function onLine(line) {
  const text = line.trim();
  mainWindow?.webContents.send('serial:line', text);
  if (text === 'ok' && busy) {
    busy = false;
    process.nextTick(drainQueue);
  }
}

function sendNow(raw) {
  return new Promise((resolve, reject) => {
    if (!port || !port.isOpen) return reject(new Error('Port not open'));
    busy = true;
    port.write(raw.endsWith('\n') ? raw : raw + '\n', (err) => {
      if (err) { busy = false; return reject(err); }
      resolve();
    });
  });
}


async function drainQueue() {
  if (busy) return;
  const item = queue.shift();
  if (!item) return;
  try { await sendNow(item); } catch (e) { console.error('send error:', e); }
}

function enqueueGcode(g) { queue.push(g); drainQueue(); }

ipcMain.handle('serial:list', async () => listPorts());
ipcMain.handle('serial:open', async (_e, cfg) => {
  await openPort({ path: cfg.path, baudRate: cfg.baudRate });
  const homing = cfg?.homing || {};
  const firmware = (cfg.firmware || 'marlin').toLowerCase();

  if (homing.onConnect) {
    if (homing.requireUnlock && homing.unlockGcode) enqueueGcode(homing.unlockGcode);

    const homeCmd = (homing.gcode && homing.gcode.trim()) ? homing.gcode : (firmware === 'grbl' ? '$H' : 'G28');
    homeCmd.split(';').map(s => s.trim()).filter(Boolean).forEach(enqueueGcode);
  }
  return true;
});

ipcMain.handle('machine:home', async (_e, { firmware = 'marlin', gcode = '', requireUnlock = false, unlockGcode = '$X' }) => {
  if (!port || !port.isOpen) throw new Error('Port not open');
  if (requireUnlock && unlockGcode) enqueueGcode(unlockGcode);
  const cmd = (gcode && gcode.trim()) ? gcode : (firmware === 'grbl' ? '$H' : 'G28');
  cmd.split(';').map(s => s.trim()).filter(Boolean).forEach(enqueueGcode);
  return true;
})
ipcMain.handle('serial:close', async () => { await closePort(); return true; });
ipcMain.handle('gcode:send', async (_e, { line }) => { enqueueGcode(line); return true; });
ipcMain.handle('gcode:sendMany', async (_e, { lines }) => { lines.forEach(enqueueGcode); return true; });
ipcMain.handle('file:openText', async () => {
  console.log('[main] file:openText invoked');
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'] });
  if (canceled || !filePaths.length) return null;
  const fs = await import('node:fs/promises');
  const txt = await fs.readFile(filePaths[0], 'utf8');
  return { path: filePaths[0], text: txt };
});

ipcMain.handle('file:openAny', async () => {
  console.log('[main] file:openAny invoked');
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'placement/Text/Zip', extensions: ['pos', 'rpt', 'csv', 'zip', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths.length) {
    console.log('[main] file:openAny canceled or empty');
    return null;
  }

  const p = filePaths[0];
  const ext = path.extname(p).toLowerCase();
  const buf = await fs.readFile(p);

  if (ext === '.zip') {
    return { path: p, name: path.basename(p), kind: 'zip', base64: buf.toString('base64') };
  } else {
    return { path: p, name: path.basename(p), kind: 'text', text: buf.toString('utf8') };
  }
});

// ---- IPC: Save text to file (.gcode) ----
ipcMain.handle('file:saveText', async (_e, { defaultName = 'job.gcode', text = '' }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'G-code', extensions: ['gcode', 'nc', 'txt'] }]
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, text, 'utf8');
  return { path: filePath };
});

process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));