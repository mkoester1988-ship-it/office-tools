import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} from 'electron';
import * as crypto from 'node:crypto';
import * as https from 'node:https';
import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { MobileSyncServer } from './syncServer';

const execFileAsync = promisify(execFile);

const SUPPORTED_EXTS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.gif',
]);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);

let mainWindow: BrowserWindow | null = null;
let snipWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let lastClipboardHash = '';
let clipboardTimer: ReturnType<typeof setInterval> | null = null;
let syncServer: MobileSyncServer | null = null;
const pendingFiles: string[] = [];

interface AppSettings {
  minimizeToTray: boolean;
  startWithWindows: boolean;
  autoOpenClipboardScreenshots: boolean;
  bringToFrontOnCapture: boolean;
  screenshotShortcut: string;
  videoShortcut: string;
  invertScrollZones: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  minimizeToTray: true,
  startWithWindows: true,
  autoOpenClipboardScreenshots: true,
  bringToFrontOnCapture: true,
  screenshotShortcut: 'CommandOrControl+Alt+S',
  videoShortcut: 'CommandOrControl+Alt+R',
  invertScrollZones: false,
};

let appSettings: AppSettings = { ...DEFAULT_SETTINGS };

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

async function loadSettings(): Promise<void> {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    appSettings = { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    appSettings = { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(): Promise<void> {
  await fs.writeFile(getSettingsPath(), JSON.stringify(appSettings, null, 2), 'utf8');
}

function applyRuntimeSettings(): { shortcutError?: string } {
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: appSettings.startWithWindows,
      args: ['--hidden'],
    });
  }
  globalShortcut.unregisterAll();
  let shortcutError: string | undefined;
  try {
    if (appSettings.screenshotShortcut) {
      const ok = globalShortcut.register(appSettings.screenshotShortcut, () => {
        startScreenshotCapture();
      });
      if (!ok) shortcutError = `Shortcut „${appSettings.screenshotShortcut}“ ist bereits belegt.`;
    }
  } catch {
    shortcutError = `Ungültiger Screenshot-Shortcut: „${appSettings.screenshotShortcut}“.`;
  }
  try {
    if (appSettings.videoShortcut) {
      const ok = globalShortcut.register(appSettings.videoShortcut, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app:toggle-video-recording');
        }
      });
      if (!ok && !shortcutError) {
        shortcutError = `Shortcut „${appSettings.videoShortcut}“ ist bereits belegt.`;
      }
    }
  } catch {
    if (!shortcutError) {
      shortcutError = `Ungültiger Video-Shortcut: „${appSettings.videoShortcut}“.`;
    }
  }
  return { shortcutError };
}

function extractFilePathsFromArgv(argv: string[]): string[] {
  const found: string[] = [];
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue;
    const ext = path.extname(arg).toLowerCase();
    if (SUPPORTED_EXTS.has(ext)) {
      found.push(path.resolve(arg));
    }
  }
  return found;
}

function sendOpenFiles(paths: string[]): void {
  if (!paths.length) return;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('app:open-files', paths);
  } else {
    pendingFiles.push(...paths);
  }
}

async function startScreenshotCapture(): Promise<void> {
  if (snipWindow && !snipWindow.isDestroyed()) {
    snipWindow.focus();
    return;
  }

  const wasVisible = mainWindow ? mainWindow.isVisible() : false;
  if (mainWindow && wasVisible) {
    mainWindow.hide();
    await new Promise((r) => setTimeout(r, 180));
  }

  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    const scaleFactor = primaryDisplay.scaleFactor || 1;
    const pixelW = Math.round(width * scaleFactor);
    const pixelH = Math.round(height * scaleFactor);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: pixelW, height: pixelH },
    });

    const source = sources[0];
    if (!source) {
      if (mainWindow && wasVisible) mainWindow.show();
      return;
    }

    const screenDataUrl = source.thumbnail.toDataURL();

    snipWindow = new BrowserWindow({
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
      width,
      height,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      fullscreen: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    const overlayHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; cursor: crosshair; user-select: none; background: #000; }
  canvas { display: block; width: 100vw; height: 100vh; }
  .hint {
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    background: rgba(15, 23, 42, 0.88); color: #f8fafc; padding: 8px 16px;
    border-radius: 999px; font-family: Segoe UI, sans-serif; font-size: 13px;
    border: 1px solid rgba(59, 130, 246, 0.7); pointer-events: none;
  }
</style>
</head>
<body>
  <div class="hint">Bereich ziehen zum Aufnehmen · Enter = Ganzer Bildschirm · Esc = Abbrechen</div>
  <canvas id="c"></canvas>
  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    let start = null, curr = null;

    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      draw();
    };
    window.electronAPI.onSnipInit((url) => { img.src = url; });

    function draw() {
      if (!img.naturalWidth) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (start && curr) {
        const sx = canvas.width / window.innerWidth;
        const sy = canvas.height / window.innerHeight;
        const x = Math.min(start.x, curr.x) * sx;
        const y = Math.min(start.y, curr.y) * sy;
        const w = Math.abs(curr.x - start.x) * sx;
        const h = Math.abs(curr.y - start.y) * sy;
        if (w > 2 && h > 2) {
          ctx.drawImage(img, x, y, w, h, x, y, w, h);
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = Math.max(2, 2 * sx);
          ctx.strokeRect(x, y, w, h);
        }
      }
    }

    window.addEventListener('mousedown', (e) => {
      start = { x: e.clientX, y: e.clientY };
      curr = { x: e.clientX, y: e.clientY };
      draw();
    });
    window.addEventListener('mousemove', (e) => {
      if (!start) return;
      curr = { x: e.clientX, y: e.clientY };
      draw();
    });
    window.addEventListener('mouseup', () => {
      if (!start || !curr) return;
      const sx = canvas.width / window.innerWidth;
      const sy = canvas.height / window.innerHeight;
      const x = Math.round(Math.min(start.x, curr.x) * sx);
      const y = Math.round(Math.min(start.y, curr.y) * sy);
      const w = Math.round(Math.abs(curr.x - start.x) * sx);
      const h = Math.round(Math.abs(curr.y - start.y) * sy);
      start = null;
      curr = null;
      if (w < 8 || h < 8) {
        window.electronAPI.finishSnip(null);
        return;
      }
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      out.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
      window.electronAPI.finishSnip(out.toDataURL('image/png'));
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.electronAPI.finishSnip(null);
      if (e.key === 'Enter' && img.src) window.electronAPI.finishSnip(img.src);
    });
  </script>
</body>
</html>`;

    snipWindow.webContents.once('did-finish-load', () => {
      snipWindow?.webContents.send('snip:init', screenDataUrl);
    });
    await snipWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml)}`);
    snipWindow.focus();
  } catch {
    if (mainWindow && wasVisible) mainWindow.show();
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
    const files = extractFilePathsFromArgv(commandLine.slice(1));
    sendOpenFiles(files);
  });
}

function createWindow(): void {
  const startHidden = process.argv.includes('--hidden');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: !startHidden,
    title: 'PDF-Reader Studio',
    backgroundColor: '#12151c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && appSettings.minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://localhost:5173' : '');
  if (devUrl && !app.isPackaged) {
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    const initialFiles = [
      ...extractFilePathsFromArgv(process.argv.slice(1)),
      ...pendingFiles.splice(0, pendingFiles.length),
    ];
    if (initialFiles.length > 0) {
      mainWindow?.webContents.send('app:open-files', Array.from(new Set(initialFiles)));
    }
    if (process.argv.includes('--just-updated')) {
      mainWindow?.webContents.send('app:just-updated', app.getVersion());
    }
  });
}

function createTray(): void {
  const iconPath = path.join(__dirname, '../build/icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) return;

  tray = new Tray(icon);
  tray.setToolTip('PDF-Reader Studio (Screenshot: Strg+Alt+S)');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Screenshot aufnehmen (Strg+Alt+S)',
        click: () => startScreenshotCapture(),
      },
      {
        label: 'PDF-Reader Studio öffnen',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: 'Auto-Öffnen bei Windows-Screenshot (Druck / Win+Shift+S)',
        type: 'checkbox',
        checked: appSettings.autoOpenClipboardScreenshots,
        click: (item) => {
          appSettings.autoOpenClipboardScreenshots = item.checked;
          saveSettings().catch(() => {});
        },
      },
      { type: 'separator' },
      {
        label: 'Beenden',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function hashBuffer(buf: Buffer): string {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function bringMainWindowToFront(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(false);
}

function startClipboardWatcher(): void {
  try {
    const initial = clipboard.readImage();
    if (!initial.isEmpty()) {
      lastClipboardHash = hashBuffer(initial.toPNG());
    }
  } catch {
    // ignore
  }

  clipboardTimer = setInterval(() => {
    if (!appSettings.autoOpenClipboardScreenshots) return;
    try {
      const img = clipboard.readImage();
      if (img.isEmpty()) return;
      const png = img.toPNG();
      if (png.length === 0) return;
      const h = hashBuffer(png);
      if (h === lastClipboardHash) return;
      lastClipboardHash = h;
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
      if (appSettings.bringToFrontOnCapture) {
        bringMainWindowToFront();
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:screenshot-captured', dataUrl);
      }
    } catch {
      // ignore transient clipboard lock
    }
  }, 450);
}

app.whenReady().then(async () => {
  await loadSettings();
  createWindow();
  createTray();
  startClipboardWatcher();
  applyRuntimeSettings();
  syncServer = new MobileSyncServer(
    app.getPath('userData'),
    app.getPath('downloads'),
    (filePath, autoOpen) => {
      if (autoOpen) {
        bringMainWindowToFront();
        sendOpenFiles([filePath]);
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:sync-file-received', path.basename(filePath));
      }
    }
  );
  syncServer.init().catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (clipboardTimer) {
    clearInterval(clipboardTimer);
    clipboardTimer = null;
  }
  syncServer?.stop();
});

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('capture:getSources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnailDataUrl: s.thumbnail.toDataURL(),
    isScreen: s.id.startsWith('screen:'),
  }));
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  return true;
});

ipcMain.handle('window:restore', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  return true;
});

ipcMain.handle('capture:start', async () => {
  await startScreenshotCapture();
  return true;
});

ipcMain.handle('capture:finish', async (_event, dataUrl: string | null) => {
  if (snipWindow && !snipWindow.isDestroyed()) {
    snipWindow.close();
  }
  snipWindow = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(false);
  }

  if (dataUrl) {
    const img = nativeImage.createFromDataURL(dataUrl);
    lastClipboardHash = hashBuffer(img.toPNG());
    clipboard.writeImage(img);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:screenshot-captured', dataUrl);
    }
  }
  return true;
});

ipcMain.handle('ocr:extractText', async (_event, dataUrl: string) => {
  const base64 = dataUrl.split(',')[1];
  if (!base64) return { text: '', lines: [] as string[] };

  const tmpPath = path.join(os.tmpdir(), `pdfreader_ocr_${Date.now()}.png`);
  try {
    await fs.writeFile(tmpPath, Buffer.from(base64, 'base64'));
    const psScript = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]

function Await($WinRtTask, $ResultType) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod })[0]
  $netTask = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}

$fs = [System.IO.File]::OpenRead(${JSON.stringify(tmpPath)})
$stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($fs)
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
  $lang = [Windows.Globalization.Language]::new('de-DE')
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
}
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$fs.Dispose()
$lines = @($result.Lines | ForEach-Object { $_.Text })
@{ text = ($lines -join "\`n"); lines = $lines } | ConvertTo-Json -Compress
`;
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    );
    const jsonLine = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{'))
      .pop();
    const parsed = JSON.parse(jsonLine || '{}');
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
    };
  } catch (err) {
    return {
      text: '',
      lines: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    fs.unlink(tmpPath).catch(() => {});
  }
});

ipcMain.handle('dialog:openFiles', async (_event, mode: 'all' | 'pdf' | 'image' = 'all') => {
  const filters =
    mode === 'pdf'
      ? [{ name: 'PDF-Dokumente', extensions: ['pdf'] }]
      : mode === 'image'
        ? [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
        : [
            { name: 'PDF & Bilder', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
            { name: 'PDF-Dokumente', extensions: ['pdf'] },
            { name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
          ];

  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters,
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('file:readBinary', async (_event, filePath: string) => {
  const buf = await fs.readFile(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    ext: path.extname(filePath).toLowerCase(),
    data: new Uint8Array(buf),
  };
});

ipcMain.handle(
  'file:writeDirect',
  async (_event, options: { filePath: string; data: Uint8Array }) => {
    try {
      await fs.writeFile(options.filePath, Buffer.from(options.data));
      return { ok: true, filePath: options.filePath };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Fehler beim Überschreiben der Datei.',
      };
    }
  }
);

ipcMain.handle(
  'file:saveBinary',
  async (_event, options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[]; data: Uint8Array }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: options.defaultPath,
      filters: options.filters ?? [{ name: 'PDF-Dokument', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    await fs.writeFile(result.filePath, Buffer.from(options.data));
    return { canceled: false, filePath: result.filePath };
  }
);

ipcMain.handle(
  'file:savePartsBatch',
  async (_event, parts: { fileName: string; data: Uint8Array }[]) => {
    const dirResult = await dialog.showOpenDialog({
      title: 'Zielordner für gespeicherte PDF-Parts wählen',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (dirResult.canceled || dirResult.filePaths.length === 0) {
      return { canceled: true, savedPaths: [] as string[] };
    }
    const targetDir = dirResult.filePaths[0];
    const savedPaths: string[] = [];

    for (const part of parts) {
      const safeName = part.fileName.replace(/[<>:"/\\|?*]/g, '_');
      const finalName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
      let outPath = path.join(targetDir, finalName);
      let counter = 1;
      const base = finalName.slice(0, -4);
      while (true) {
        try {
          await fs.access(outPath);
          outPath = path.join(targetDir, `${base}_${counter}.pdf`);
          counter++;
        } catch {
          break;
        }
      }
      await fs.writeFile(outPath, Buffer.from(part.data));
      savedPaths.push(outPath);
    }

    return { canceled: false, targetDir, savedPaths };
  }
);

ipcMain.handle('file:listSiblingImages', async (_event, filePath: string) => {
  try {
    const dir = path.dirname(filePath);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(dir, entry.name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  } catch {
    return [filePath];
  }
});

ipcMain.handle('clipboard:writeImage', async (_event, dataUrl: string) => {
  const img = nativeImage.createFromDataURL(dataUrl);
  lastClipboardHash = hashBuffer(img.toPNG());
  clipboard.writeImage(img);
  return true;
});

ipcMain.handle('clipboard:writeText', async (_event, text: string) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('shell:showItemInFolder', async (_event, targetPath: string) => {
  shell.showItemInFolder(targetPath);
  return true;
});

ipcMain.handle('settings:get', async () => {
  return appSettings;
});

ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
  appSettings = { ...appSettings, ...patch };
  await saveSettings();
  const { shortcutError } = applyRuntimeSettings();
  return { settings: appSettings, shortcutError };
});

ipcMain.handle('sync:getStatus', async () => {
  if (!syncServer) return null;
  return syncServer.getStatus();
});

ipcMain.handle('sync:chooseDir', async () => {
  if (!syncServer) return null;
  const res = await dialog.showOpenDialog({
    title: 'Zielordner für Handy-Sync wählen',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return syncServer.getStatus();
  return syncServer.updateConfig({ targetDir: res.filePaths[0] });
});

ipcMain.handle('sync:setAutoOpen', async (_event, autoOpen: boolean) => {
  if (!syncServer) return null;
  return syncServer.updateConfig({ autoOpenOnReceive: autoOpen });
});

ipcMain.handle('sync:regenerateToken', async () => {
  if (!syncServer) return null;
  return syncServer.regenerateToken();
});

ipcMain.handle('sync:allowFirewall', async () => {
  const batPath = path.join(os.tmpdir(), `pdfreader_fw_${Date.now()}.cmd`);
  const batContent = [
    '@echo off',
    'netsh advfirewall firewall delete rule name="PDF-Reader Studio Handy-Sync" >nul 2>&1',
    'netsh advfirewall firewall add rule name="PDF-Reader Studio Handy-Sync" dir=in action=allow protocol=TCP localport=3847 profile=any',
  ].join('\r\n');
  try {
    await fs.writeFile(batPath, batContent, 'utf8');
    const safeBat = batPath.replace(/'/g, "''");
    const psCmd = `Start-Process -FilePath '${safeBat}' -Verb RunAs -Wait -WindowStyle Hidden`;
    const encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encoded,
    ]);
    // Verify rule actually exists
    const { stdout } = await execFileAsync('netsh', [
      'advfirewall',
      'firewall',
      'show',
      'rule',
      'name=PDF-Reader Studio Handy-Sync',
    ]);
    const ok = stdout.includes('3847');
    return ok ? { ok: true } : { ok: false, error: 'Regel wurde nicht angelegt (evtl. UAC abgebrochen).' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    fs.unlink(batPath).catch(() => {});
  }
});

ipcMain.handle('app:print', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.print({ silent: false, printBackground: true });
  return true;
});

ipcMain.handle('app:registerDefaultApp', async () => {
  const exePath = process.execPath;
  const exts = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
  const psCommands = [
    `New-Item -Path 'HKCU:\\Software\\Classes\\PDFReaderStudio.File\\shell\\open\\command' -Force | Out-Null`,
    `Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\PDFReaderStudio.File\\shell\\open\\command' -Name '(Default)' -Value '"${exePath}" "%1"'`,
    `New-Item -Path 'HKCU:\\Software\\Classes\\PDFReaderStudio.File\\DefaultIcon' -Force | Out-Null`,
    `Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\PDFReaderStudio.File\\DefaultIcon' -Name '(Default)' -Value '"${exePath}",0'`,
    `New-Item -Path 'HKCU:\\Software\\PDFReaderStudio\\Capabilities\\FileAssociations' -Force | Out-Null`,
    `Set-ItemProperty -Path 'HKCU:\\Software\\PDFReaderStudio\\Capabilities' -Name 'ApplicationName' -Value 'PDF-Reader Studio'`,
    `Set-ItemProperty -Path 'HKCU:\\Software\\PDFReaderStudio\\Capabilities' -Name 'ApplicationDescription' -Value 'PDF-Reader, Part-Splitter, Bildviewer & KI-Screenshot-Studio'`,
    ...exts.map(
      (ext) =>
        `Set-ItemProperty -Path 'HKCU:\\Software\\PDFReaderStudio\\Capabilities\\FileAssociations' -Name '${ext}' -Value 'PDFReaderStudio.File'`
    ),
    `New-Item -Path 'HKCU:\\Software\\RegisteredApplications' -Force | Out-Null`,
    `Set-ItemProperty -Path 'HKCU:\\Software\\RegisteredApplications' -Name 'PDFReaderStudio' -Value 'Software\\PDFReaderStudio\\Capabilities'`,
  ].join('\n');

  try {
    const encoded = Buffer.from(psCommands, 'utf16le').toString('base64');
    await execFileAsync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encoded,
    ]);
    await shell.openExternal('ms-settings:defaultapps');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

const WORKSPACE_DIR = 'D:\\KI-Arbeitsbereich\\PDF-Reader';
const GITHUB_REPO = 'mkoester1988-ship-it/office-tools';

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

function fetchJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { 'User-Agent': 'PDF-Reader-Studio', Accept: 'application/vnd.github+json' } },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            fetchJson(res.headers.location).then(resolve, reject);
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        }
      )
      .on('error', reject);
  });
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'PDF-Reader-Studio' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadFile(res.headers.location, destPath).then(resolve, reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Download HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', async () => {
          try {
            await fs.writeFile(destPath, Buffer.concat(chunks));
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

ipcMain.handle('app:checkUpdate', async () => {
  const currentVersion = app.getVersion();

  // 1. Check local workspace release folder (if available on dev PC)
  try {
    const releaseDir = path.join(WORKSPACE_DIR, 'release');
    const entries = await fs.readdir(releaseDir, { withFileTypes: true });
    const setups = entries
      .filter((e) => e.isFile() && /^PDF-Reader Studio Setup .*\.exe$/i.test(e.name))
      .map((e) => path.join(releaseDir, e.name));

    if (setups.length > 0) {
      let newestSetup = setups[0];
      let newestMtime = 0;
      for (const s of setups) {
        const st = await fs.stat(s);
        if (st.mtimeMs > newestMtime) {
          newestMtime = st.mtimeMs;
          newestSetup = s;
        }
      }
      const pkgRaw = await fs.readFile(path.join(WORKSPACE_DIR, 'package.json'), 'utf8');
      const pkg = JSON.parse(pkgRaw);
      const latestLocal = typeof pkg.version === 'string' ? pkg.version : currentVersion;
      if (app.isPackaged && compareSemver(latestLocal, currentVersion) > 0) {
        return {
          hasUpdate: true,
          currentVersion,
          latestVersion: latestLocal,
          setupPath: newestSetup,
          reason: `Neue lokale Version (${latestLocal}) verfügbar.`,
        };
      }
    }
  } catch {
    // Fallback to GitHub Releases (e.g. on Mom's PC)
  }

  // 2. Check GitHub Releases (public repo, no login required)
  try {
    const release = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    const tag = typeof release.tag_name === 'string' ? release.tag_name : currentVersion;
    const latestVersion = tag.replace(/^v/i, '');
    const assets = Array.isArray(release.assets)
      ? (release.assets as { name?: string; browser_download_url?: string }[])
      : [];
    const exeAsset = assets.find((a) => typeof a.name === 'string' && /\.exe$/i.test(a.name));
    const hasUpdate =
      Boolean(exeAsset?.browser_download_url) && compareSemver(latestVersion, currentVersion) > 0;

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      setupPath: exeAsset?.browser_download_url,
      reason: hasUpdate
        ? `Neue Version (${latestVersion}) auf GitHub verfügbar.`
        : `Aktuell (v${currentVersion}).`,
    };
  } catch (err) {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      reason: `Aktuell (v${currentVersion}).`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

ipcMain.handle('app:installUpdate', async (_event, setupPathOrUrl: string) => {
  if (!setupPathOrUrl) return false;
  let localSetupPath = setupPathOrUrl;
  if (/^https?:\/\//i.test(setupPathOrUrl)) {
    localSetupPath = path.join(os.tmpdir(), `PDF-Reader-Studio-Setup-${Date.now()}.exe`);
    await downloadFile(setupPathOrUrl, localSetupPath);
  }
  const exePath = process.execPath;
  const pid = process.pid;
  const safeSetup = localSetupPath.replace(/'/g, "''");
  const safeExe = exePath.replace(/'/g, "''");
  const psCommand = `
$pidToWait = ${pid}
for ($i = 0; $i -lt 30; $i++) {
  if (-not (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 200
}
Get-Process -Name 'PDF-Reader Studio' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400
Start-Process -FilePath '${safeSetup}' -ArgumentList '/S' -Wait
for ($j = 0; $j -lt 30; $j++) {
  if (Test-Path '${safeExe}') { break }
  Start-Sleep -Milliseconds 300
}
Start-Sleep -Milliseconds 500
Start-Process -FilePath '${safeExe}' -ArgumentList '--just-updated'
`;
  const scriptPath = path.join(os.tmpdir(), `pdfreader_updater_${Date.now()}.ps1`);
  await fs.writeFile(scriptPath, psCommand, 'utf8');
  const child = spawn(
    'cmd.exe',
    [
      '/c',
      'start',
      '""',
      '/min',
      'powershell.exe',
      '-NoProfile',
      '-WindowStyle',
      'Hidden',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
    ],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref();
  app.exit(0);
  return true;
});
