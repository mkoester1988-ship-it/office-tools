import { contextBridge, ipcRenderer } from 'electron';

export interface FilePayload {
  path: string;
  name: string;
  ext: string;
  data: Uint8Array;
}

const api = {
  openFiles: (mode: 'all' | 'pdf' | 'image' = 'all'): Promise<string[]> =>
    ipcRenderer.invoke('dialog:openFiles', mode),
  readBinary: (filePath: string): Promise<FilePayload> =>
    ipcRenderer.invoke('file:readBinary', filePath),
  saveBinary: (options: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
    data: Uint8Array;
  }): Promise<{ canceled: boolean; filePath?: string }> =>
    ipcRenderer.invoke('file:saveBinary', options),
  savePartsBatch: (
    parts: { fileName: string; data: Uint8Array }[]
  ): Promise<{ canceled: boolean; targetDir?: string; savedPaths: string[] }> =>
    ipcRenderer.invoke('file:savePartsBatch', parts),
  listSiblingImages: (filePath: string): Promise<string[]> =>
    ipcRenderer.invoke('file:listSiblingImages', filePath),
  writeClipboardImage: (dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard:writeImage', dataUrl),
  writeClipboardText: (text: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard:writeText', text),
  showItemInFolder: (targetPath: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:showItemInFolder', targetPath),
  printWindow: (): Promise<boolean> => ipcRenderer.invoke('app:print'),
  getSyncStatus: (): Promise<unknown> => ipcRenderer.invoke('sync:getStatus'),
  chooseSyncDir: (): Promise<unknown> => ipcRenderer.invoke('sync:chooseDir'),
  setSyncAutoOpen: (autoOpen: boolean): Promise<unknown> =>
    ipcRenderer.invoke('sync:setAutoOpen', autoOpen),
  regenerateSyncToken: (): Promise<unknown> => ipcRenderer.invoke('sync:regenerateToken'),
  allowSyncFirewall: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('sync:allowFirewall'),
  onSyncFileReceived: (callback: (fileName: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, fileName: string) => callback(fileName);
    ipcRenderer.on('app:sync-file-received', listener);
    return () => ipcRenderer.removeListener('app:sync-file-received', listener);
  },
  registerDefaultApp: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('app:registerDefaultApp'),
  checkUpdate: (): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string;
    setupPath?: string;
    reason: string;
  }> => ipcRenderer.invoke('app:checkUpdate'),
  installUpdate: (setupPath: string): Promise<boolean> =>
    ipcRenderer.invoke('app:installUpdate', setupPath),
  startScreenshot: (): Promise<boolean> => ipcRenderer.invoke('capture:start'),
  onSnipInit: (callback: (dataUrl: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, dataUrl: string) => callback(dataUrl);
    ipcRenderer.on('snip:init', listener);
    return () => ipcRenderer.removeListener('snip:init', listener);
  },
  getCaptureSources: (): Promise<
    { id: string; name: string; thumbnailDataUrl: string; isScreen: boolean }[]
  > => ipcRenderer.invoke('capture:getSources'),
  minimizeWindow: (): Promise<boolean> => ipcRenderer.invoke('window:minimize'),
  restoreWindow: (): Promise<boolean> => ipcRenderer.invoke('window:restore'),
  onToggleVideoRecording: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:toggle-video-recording', listener);
    return () => ipcRenderer.removeListener('app:toggle-video-recording', listener);
  },
  finishSnip: (dataUrl: string | null): Promise<boolean> =>
    ipcRenderer.invoke('capture:finish', dataUrl),
  extractOcrText: (
    dataUrl: string
  ): Promise<{ text: string; lines: string[]; error?: string }> =>
    ipcRenderer.invoke('ocr:extractText', dataUrl),
  onOpenFiles: (callback: (paths: string[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, paths: string[]) => callback(paths);
    ipcRenderer.on('app:open-files', listener);
    return () => ipcRenderer.removeListener('app:open-files', listener);
  },
  onJustUpdated: (callback: (version: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, version: string) => callback(version);
    ipcRenderer.on('app:just-updated', listener);
    return () => ipcRenderer.removeListener('app:just-updated', listener);
  },
  onScreenshotCaptured: (callback: (dataUrl: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, dataUrl: string) => callback(dataUrl);
    ipcRenderer.on('app:screenshot-captured', listener);
    return () => ipcRenderer.removeListener('app:screenshot-captured', listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
