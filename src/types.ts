export interface FilePayload {
  path: string;
  name: string;
  ext: string;
  data: Uint8Array;
}

export interface ElectronAPI {
  openFiles: (mode?: 'all' | 'pdf' | 'image') => Promise<string[]>;
  readBinary: (filePath: string) => Promise<FilePayload>;
  saveBinary: (options: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
    data: Uint8Array;
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  savePartsBatch: (
    parts: { fileName: string; data: Uint8Array }[]
  ) => Promise<{ canceled: boolean; targetDir?: string; savedPaths: string[] }>;
  listSiblingImages: (filePath: string) => Promise<string[]>;
  writeClipboardImage: (dataUrl: string) => Promise<boolean>;
  writeClipboardText: (text: string) => Promise<boolean>;
  showItemInFolder: (targetPath: string) => Promise<boolean>;
  printWindow: () => Promise<boolean>;
  getSyncStatus: () => Promise<SyncStatus | null>;
  chooseSyncDir: () => Promise<SyncStatus | null>;
  setSyncAutoOpen: (autoOpen: boolean) => Promise<SyncStatus | null>;
  regenerateSyncToken: () => Promise<SyncStatus | null>;
  allowSyncFirewall: () => Promise<{ ok: boolean; error?: string }>;
  onSyncFileReceived: (callback: (fileName: string) => void) => () => void;
  registerDefaultApp: () => Promise<{ ok: boolean; error?: string }>;
  checkUpdate: () => Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string;
    setupPath?: string;
    reason: string;
  }>;
  installUpdate: (setupPath: string) => Promise<boolean>;
  startScreenshot: () => Promise<boolean>;
  getCaptureSources: () => Promise<
    { id: string; name: string; thumbnailDataUrl: string; isScreen: boolean }[]
  >;
  minimizeWindow: () => Promise<boolean>;
  restoreWindow: () => Promise<boolean>;
  onToggleVideoRecording: (callback: () => void) => () => void;
  finishSnip: (dataUrl: string | null) => Promise<boolean>;
  extractOcrText: (
    dataUrl: string
  ) => Promise<{ text: string; lines: string[]; error?: string }>;
  onOpenFiles: (callback: (paths: string[]) => void) => () => void;
  onJustUpdated: (callback: (version: string) => void) => () => void;
  onScreenshotCaptured: (callback: (dataUrl: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export interface PdfSource {
  id: string;
  name: string;
  bytes: Uint8Array;
}

export interface VirtualPage {
  id: string;
  sourceId: string;
  sourcePageIndex: number; // 0-based index in PdfSource
  rotation: number; // 0, 90, 180, 270
  partId: string;
}

export interface PdfPart {
  id: string;
  name: string;
  color: string;
  savedPath?: string;
}

export interface PdfHighlight {
  id: string;
  pageId: string;
  xNorm: number; // 0..1 relative to page width
  yNorm: number; // 0..1 relative to page height (top-down)
  wNorm: number;
  hNorm: number;
  color: string;
}

export interface PdfFormFieldValue {
  name: string;
  kind: 'text' | 'checkbox' | 'dropdown' | 'radio';
  value: string | boolean;
  options?: string[];
}

export interface PdfTab {
  id: string;
  kind: 'pdf';
  title: string;
  sources: PdfSource[];
  pages: VirtualPage[];
  parts: PdfPart[];
  activePageIndex: number; // 0-based index in pages
  highlights?: PdfHighlight[];
  formValues?: Record<string, string | boolean>;
}

export interface ImageTab {
  id: string;
  kind: 'image';
  title: string;
  filePath?: string;
  dataUrl: string;
  siblingPaths: string[];
}

export interface SyncStatus {
  running: boolean;
  port: number;
  url: string;
  qrDataUrl: string;
  config: {
    token: string;
    targetDir: string;
    autoOpenOnReceive: boolean;
  };
}

export interface VideoTab {
  id: string;
  kind: 'video';
  title: string;
  blobUrl: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type AppTab = PdfTab | ImageTab | VideoTab;

export type AnnotationTool =
  | 'pan'
  | 'rect'
  | 'circle'
  | 'arrow'
  | 'freehand'
  | 'badge'
  | 'callout'
  | 'text'
  | 'blur'
  | 'crop';

export interface Annotation {
  id: string;
  tool: Exclude<AnnotationTool, 'pan' | 'crop'>;
  color: string;
  strokeWidth: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  points?: { x: number; y: number }[];
  text?: string;
  badgeNumber?: number;
}
