import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  ClipboardPaste,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Moon,
  RefreshCw,
  Settings,
  ShieldCheck,
  Smartphone,
  Square,
  Sun,
  Video,
  X,
} from 'lucide-react';
import type { AppTab, ImageTab, PdfPart, PdfTab, VideoTab, VirtualPage } from './types';
import { PART_COLORS, clearPdfJsCache, loadPdfPageCount } from './utils/pdfOperations';
import { PdfWorkspace } from './components/PdfWorkspace';
import { ImageStudio } from './components/ImageStudio';
import { VideoStudio } from './components/VideoStudio';
import { RecordModal } from './components/RecordModal';
import { SyncModal } from './components/SyncModal';
import { MobilePairModal } from './components/MobilePairModal';
import { SettingsModal } from './components/SettingsModal';
import {
  APP_VERSION,
  getPcSyncPairing,
  isElectron,
  pickLocalFilesWeb,
  setPcSyncPairing,
} from './utils/platformBridge';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);

function bytesToDataUrl(bytes: Uint8Array, ext: string): string {
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
  };
  const mime = mimeMap[ext] ?? 'image/png';
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export const App: React.FC = () => {
  const [tabs, setTabs] = useState<AppTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [toast, setToast] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{
    hasUpdate: boolean;
    setupPath?: string;
    latestVersion: string;
    reason: string;
  } | null>(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showMobilePairModal, setShowMobilePairModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recStreamsRef = useRef<MediaStream[]>([]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const handleUpdateClick = async () => {
    if (!isElectron()) {
      const pairing = getPcSyncPairing();
      if (!pairing) {
        setShowMobilePairModal(true);
        showToast('Bitte zuerst den Sync-Link vom PC eingeben.');
        return;
      }
      try {
        const res = await fetch(`${pairing.baseUrl}/api/apk-version?token=${encodeURIComponent(pairing.token)}`);
        const data = (await res.json()) as { available?: boolean; version?: string };
        const isNewer = (remote: string, local: string) => {
          const ra = remote.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
          const la = local.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
          for (let i = 0; i < 3; i++) {
            if ((ra[i] ?? 0) > (la[i] ?? 0)) return true;
            if ((ra[i] ?? 0) < (la[i] ?? 0)) return false;
          }
          return false;
        };
        if (data.available && data.version && isNewer(data.version, APP_VERSION)) {
          if (window.confirm(`Neue Handy-App v${data.version} auf deinem PC gefunden. Jetzt herunterladen & installieren?`)) {
            const apkUrl = `${pairing.baseUrl}/api/download-apk?token=${encodeURIComponent(pairing.token)}`;
            if (window.AndroidNative) {
              showToast('Lade Update vom PC...');
              window.AndroidNative.installApkFromUrl(apkUrl);
            } else {
              window.location.href = apkUrl;
            }
          }
        } else {
          showToast(`Handy-App ist aktuell (v${APP_VERSION}).`);
        }
      } catch {
        showToast('PC im WLAN nicht erreichbar.');
      }
      return;
    }

    const res = await window.electronAPI.checkUpdate();
    setUpdateInfo(res);
    if (res.hasUpdate && res.setupPath) {
      const ok = window.confirm(
        `Update auf Version ${res.latestVersion} verfügbar!\n\nJetzt automatisch im Hintergrund installieren und PDF-Reader Studio neu starten?`
      );
      if (ok) {
        showToast('Update wird installiert, App startet gleich neu...');
        await window.electronAPI.installUpdate(res.setupPath);
      }
    } else {
      showToast(res.reason || 'Du nutzt bereits die aktuellste Version.');
    }
  };

  const openBinaryFiles = useCallback(
    async (items: { name: string; ext: string; data: Uint8Array; path?: string }[]) => {
      for (const payload of items) {
        try {
          if (payload.ext === '.pdf') {
            const pageCount = await loadPdfPageCount(payload.data);
            const sourceId = `src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const partId = `part_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const baseName = payload.name.replace(/\.pdf$/i, '');

            const part: PdfPart = {
              id: partId,
              name: baseName,
              color: PART_COLORS[0],
            };
            const pages: VirtualPage[] = Array.from({ length: pageCount }, (_, i) => ({
              id: `${sourceId}_p${i}`,
              sourceId,
              sourcePageIndex: i,
              rotation: 0,
              partId,
            }));

            const newTab: PdfTab = {
              id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              kind: 'pdf',
              title: payload.name,
              sources: [{ id: sourceId, name: payload.name, filePath: payload.path, bytes: payload.data }],
              pages,
              parts: [part],
              activePageIndex: 0,
            };

            setTabs((prev) => [...prev, newTab]);
            setActiveTabId(newTab.id);
          } else if (IMAGE_EXTS.has(payload.ext)) {
            const dataUrl = bytesToDataUrl(payload.data, payload.ext);
            const siblings =
              isElectron() && payload.path
                ? await window.electronAPI.listSiblingImages(payload.path)
                : [];
            const newTab: ImageTab = {
              id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              kind: 'image',
              title: payload.name,
              filePath: payload.path,
              dataUrl,
              siblingPaths: siblings,
            };
            setTabs((prev) => [...prev, newTab]);
            setActiveTabId(newTab.id);
          }
        } catch (err) {
          showToast(`Fehler beim Öffnen: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
    [showToast]
  );

  const openFilePaths = useCallback(
    async (paths: string[]) => {
      if (!isElectron()) return;
      const loaded = [];
      for (const filePath of paths) {
        loaded.push(await window.electronAPI.readBinary(filePath));
      }
      await openBinaryFiles(loaded);
    },
    [openBinaryFiles]
  );

  // Listen for files opened via Windows Explorer double-click / CLI args (Desktop) or Android Intent
  useEffect(() => {
    if (!isElectron()) {
      const openDetail = async (detail: { name: string; base64: string; mimeType: string }) => {
        if (!detail?.base64) return;
        const bin = Uint8Array.from(atob(detail.base64), (c) => c.charCodeAt(0));
        const ext = detail.name.includes('.')
          ? detail.name.slice(detail.name.lastIndexOf('.')).toLowerCase()
          : detail.mimeType.includes('pdf')
            ? '.pdf'
            : '.png';
        await openBinaryFiles([{ name: detail.name || 'Dokument.pdf', ext, data: bin }]);
      };

      const pendingRaw = window.AndroidNative?.consumePendingFile();
      if (pendingRaw) {
        try {
          openDetail(JSON.parse(pendingRaw));
        } catch {
          // ignore
        }
      }

      const onAndroidFile = async (ev: Event) => {
        await openDetail((ev as CustomEvent<{ name: string; base64: string; mimeType: string }>).detail);
      };
      window.addEventListener('android-open-file', onAndroidFile);
      return () => window.removeEventListener('android-open-file', onAndroidFile);
    }
    return window.electronAPI.onOpenFiles((paths) => {
      openFilePaths(paths);
    });
  }, [openFilePaths, openBinaryFiles]);

  useEffect(() => {
    if (!isElectron()) return;
    return window.electronAPI.onJustUpdated((version) => {
      showToast(`Update auf v${version} erfolgreich installiert!`);
    });
  }, [showToast]);

  useEffect(() => {
    if (!isElectron()) return;
    return window.electronAPI.onSyncFileReceived((fileName) => {
      showToast(`Vom Handy empfangen & gespeichert: ${fileName}`);
    });
  }, [showToast]);

  // Listen for captured screenshots from global shortcut / Capture button
  useEffect(() => {
    if (!isElectron()) return;
    return window.electronAPI.onScreenshotCaptured((dataUrl) => {
      const newTab: ImageTab = {
        id: `tab_${Date.now()}`,
        kind: 'image',
        title: `Screenshot_${new Date().toLocaleTimeString('de-DE').replace(/:/g, '-')}.png`,
        dataUrl,
        siblingPaths: [],
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      showToast('Screenshot ist in der Zwischenablage und bereit für Markierungen & Kommentare.');
    });
  }, [showToast]);

  // Global Paste (Ctrl+V) on Welcome Screen or when pasting an image from Windows Snipping Tool
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              const newTab: ImageTab = {
                id: `tab_${Date.now()}`,
                kind: 'image',
                title: `Zwischenablage_${new Date().toLocaleTimeString('de-DE').replace(/:/g, '-')}.png`,
                dataUrl: reader.result,
                siblingPaths: [],
              };
              setTabs((prev) => [...prev, newTab]);
              setActiveTabId(newTab.id);
              showToast('Bild aus Zwischenablage geöffnet.');
            }
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [showToast]);

  const stopVideoRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }
    const timer = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    if (!isElectron()) return;
    return window.electronAPI.onToggleVideoRecording(() => {
      if (isRecording) {
        stopVideoRecording();
      } else {
        setShowRecordModal(true);
      }
    });
  }, [isRecording, stopVideoRecording]);

  const startVideoRecording = async (
    sourceId: string,
    _sourceName: string,
    includeMic: boolean,
    minimize: boolean
  ) => {
    try {
      setShowRecordModal(false);
      const desktopStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
          },
        } as unknown as MediaTrackConstraints,
      });

      const streamsToStop: MediaStream[] = [desktopStream];
      let combinedStream = desktopStream;

      if (includeMic) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          streamsToStop.push(micStream);
          combinedStream = new MediaStream([
            ...desktopStream.getVideoTracks(),
            ...micStream.getAudioTracks(),
          ]);
        } catch {
          showToast('Mikrofon konnte nicht aktiviert werden, Aufnahme läuft ohne Ton.');
        }
      }

      recStreamsRef.current = streamsToStop;

      const mimeCandidates = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      const mimeType =
        mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(combinedStream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        recStreamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
        recStreamsRef.current = [];
        setIsRecording(false);
        await window.electronAPI.restoreWindow();

        const blob = new Blob(chunks, { type: mimeType });
        const buf = new Uint8Array(await blob.arrayBuffer());
        const blobUrl = URL.createObjectURL(blob);
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const newTab: VideoTab = {
          id: `tab_${Date.now()}`,
          kind: 'video',
          title: `Aufnahme_${new Date().toLocaleTimeString('de-DE').replace(/:/g, '-')}.${ext}`,
          blobUrl,
          mimeType,
          bytes: buf,
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(newTab.id);
        showToast('Bildschirmvideo fertig! Jetzt abspielen, Einzelbild markieren oder speichern.');
      };

      recorder.start(250);
      setIsRecording(true);
      if (minimize) {
        await window.electronAPI.minimizeWindow();
      }
      showToast('Videoaufnahme läuft (Stoppen mit Strg+Alt+R).');
    } catch (err) {
      showToast(`Aufnahme fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenDialog = async (mode: 'all' | 'pdf' | 'image' = 'all') => {
    if (!isElectron()) {
      const accept =
        mode === 'pdf' ? '.pdf' : mode === 'image' ? 'image/*' : '.pdf,image/*';
      const picked = await pickLocalFilesWeb(accept);
      if (picked.length) await openBinaryFiles(picked);
      return;
    }
    const paths = await window.electronAPI.openFiles(mode);
    if (paths.length) await openFilePaths(paths);
  };

  const handleCloseTab = (tabId: string) => {
    setTabs((prev) => {
      const target = prev.find((t) => t.id === tabId);
      if (target && target.kind === 'pdf') {
        target.sources.forEach((s) => clearPdfJsCache(s.id));
      } else if (target && target.kind === 'video') {
        URL.revokeObjectURL(target.blobUrl);
      }
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(next.length ? next[next.length - 1].id : null);
      }
      return next;
    });
  };

  const handleNavigateSibling = async (tabId: string, filePath: string) => {
    const payload = await window.electronAPI.readBinary(filePath);
    const dataUrl = bytesToDataUrl(payload.data, payload.ext);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId && t.kind === 'image'
          ? { ...t, title: payload.name, filePath: payload.path, dataUrl }
          : t
      )
    );
  };

  const handleSendPdfPageToStudio = (title: string, dataUrl: string) => {
    const newTab: ImageTab = {
      id: `tab_${Date.now()}`,
      kind: 'image',
      title,
      dataUrl,
      siblingPaths: [],
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    showToast('PDF-Seite ins KI-Markierungsstudio übernommen.');
  };

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const droppedPaths = Array.from(e.dataTransfer.files)
          .map((f) => (f as File & { path?: string }).path)
          .filter((p): p is string => Boolean(p));
        if (droppedPaths.length) {
          openFilePaths(droppedPaths);
        }
      }}
    >
      {/* Top Tab Bar */}
      <header className="tab-bar">
        <button
          className="btn btn-primary"
          style={{ marginBottom: 6, marginRight: 6, padding: '5px 10px' }}
          onClick={() => handleOpenDialog('all')}
        >
          <FolderOpen size={15} /> Öffnen
        </button>
        {isElectron() && (
          <>
            <button
              className="btn btn-success"
              style={{ marginBottom: 6, marginRight: 6, padding: '5px 10px' }}
              onClick={() => window.electronAPI.startScreenshot()}
              title="Bildschirmbereich aufnehmen (auch global per Strg+Alt+S)"
            >
              <Camera size={15} /> Screenshot
            </button>
            {isRecording ? (
              <button
                className="btn"
                style={{
                  marginBottom: 6,
                  marginRight: 6,
                  padding: '5px 10px',
                  background: '#ef4444',
                  color: '#fff',
                }}
                onClick={stopVideoRecording}
                title="Videoaufnahme stoppen (auch global per Strg+Alt+R)"
              >
                <Square size={14} /> Stopp ({recordingSeconds}s)
              </button>
            ) : (
              <button
                className="btn"
                style={{ marginBottom: 6, marginRight: 6, padding: '5px 10px' }}
                onClick={() => setShowRecordModal(true)}
                title="Bildschirmvideo aufnehmen (Strg+Alt+R)"
              >
                <Video size={15} color="#ef4444" /> Video
              </button>
            )}
          </>
        )}

        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
            title={tab.title}
          >
            {tab.kind === 'pdf' ? (
              <FileText size={14} />
            ) : tab.kind === 'video' ? (
              <Video size={14} />
            ) : (
              <ImageIcon size={14} />
            )}
            <span className="tab-title">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                handleCloseTab(tab.id);
              }}
              title="Tab schließen"
            >
              <X size={13} />
            </button>
          </div>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 6 }}>
          <button
            className="btn"
            onClick={() => {
              if (!isElectron()) {
                setShowMobilePairModal(true);
                return;
              }
              setShowSyncModal(true);
            }}
            title="Handy per QR-Code verbinden & Dateien synchronisieren"
          >
            <Smartphone size={14} color="#3b82f6" /> {isElectron() ? 'Handy-Sync' : 'PC-Kopplung'}
          </button>
          {isElectron() && (
            <button
              className="btn"
              onClick={async () => {
                const res = await window.electronAPI.registerDefaultApp();
                if (res.ok) {
                  showToast('Als Standard-App registriert. Wähle jetzt in Windows „PDF-Reader Studio“.');
                } else {
                  showToast(`Fehler: ${res.error}`);
                }
              }}
              title="PDF-Reader Studio als Windows-Standard-App für PDFs & Bilder registrieren"
            >
              <ShieldCheck size={14} /> Standard-App
            </button>
          )}
          <button
            className={`btn ${updateInfo?.hasUpdate ? 'btn-success' : ''}`}
            onClick={handleUpdateClick}
            title={updateInfo?.reason || 'Nach App-Updates suchen'}
          >
            <RefreshCw size={14} />
            {updateInfo?.hasUpdate ? 'Update installieren' : 'Update'}
          </button>
          <button
            className="btn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title="Helles / Dunkles Design umschalten"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          {isElectron() && (
            <button
              className="btn"
              onClick={() => setShowSettingsModal(true)}
              title="Einstellungen & Tastenkürzel"
            >
              <Settings size={15} />
            </button>
          )}
        </div>
      </header>

      {/* Active Workspace */}
      {!activeTab ? (
        <div className="welcome-screen">
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>PDF-Reader Studio</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', maxWidth: 580, fontSize: 14.5 }}>
            Schneller PDF-Reader mit interaktivem Part-Splitter (Trennen, Anreihen, Abreihen) und
            integriertem Bildviewer für KI-Markierungen direkt in die Zwischenablage. Dateien
            einfach hierher ziehen oder unten wählen.
          </p>

          <div className="welcome-cards">
            <div className="welcome-card" onClick={() => handleOpenDialog('pdf')}>
              <FileText size={28} color="#3b82f6" />
              <h3 style={{ margin: '12px 0 6px 0', fontSize: 16 }}>PDF öffnen & trennen</h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                Lesen, suchen, drehen, an beliebiger Stelle schneiden, Parts einzeln speichern oder
                weitere PDFs anreihen.
              </p>
            </div>

            <div className="welcome-card" onClick={() => handleOpenDialog('image')}>
              <ImageIcon size={28} color="#10b981" />
              <h3 style={{ margin: '12px 0 6px 0', fontSize: 16 }}>Bildviewer & KI-Markierung</h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                Pixelgenauer Zoom, Ordner-Blättern, Pfeile, Rahmen, Nummern, Unschärfe und 1-Klick
                Zwischenablage.
              </p>
            </div>

            {isElectron() ? (
              <>
                <div
                  className="welcome-card"
                  onClick={() => window.electronAPI.startScreenshot()}
                >
                  <Camera size={28} color="#ec4899" />
                  <h3 style={{ margin: '12px 0 6px 0', fontSize: 16 }}>
                    Screenshot für KI (Strg+Alt+S)
                  </h3>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                    Bereich aufnehmen, sofort in Zwischenablage, Text per OCR auslesen und schnell
                    Kommentare & Markierungen setzen.
                  </p>
                </div>

                <div
                  className="welcome-card"
                  onClick={() => setShowRecordModal(true)}
                >
                  <Video size={28} color="#ef4444" />
                  <h3 style={{ margin: '12px 0 6px 0', fontSize: 16 }}>
                    Bildschirmvideo (Strg+Alt+R)
                  </h3>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                    Bildschirm oder Fenster mit optionalem Mikrofon aufnehmen, abspielen, Einzelbild
                    markieren & speichern.
                  </p>
                </div>

                <div
                  className="welcome-card"
                  onClick={() => showToast('Drücke Strg+V, um ein Bild aus der Zwischenablage zu öffnen.')}
                >
                  <ClipboardPaste size={28} color="#f59e0b" />
                  <h3 style={{ margin: '12px 0 6px 0', fontSize: 16 }}>Screenshot einfügen (Strg+V)</h3>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                    Direkt nach Win+Shift+S hier mit Strg+V einfügen, markieren und mit Strg+C an die
                    KI übergeben.
                  </p>
                </div>
              </>
            ) : (
              <div
                className="welcome-card"
                onClick={() => setShowMobilePairModal(true)}
              >
                <Smartphone size={28} color="#3b82f6" />
                <h3 style={{ margin: '12px 0 6px 0', fontSize: 16 }}>Mit PC koppeln</h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                  Einmal mit deinem PC verbinden, um PDFs/Bilder direkt auf den PC zu speichern und
                  Updates zu laden.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : activeTab.kind === 'pdf' ? (
        <PdfWorkspace
          tab={activeTab}
          onUpdateTab={(updater) =>
            setTabs((prev) =>
              prev.map((t) => (t.id === activeTab.id && t.kind === 'pdf' ? updater(t) : t))
            )
          }
          onSendImageToStudio={handleSendPdfPageToStudio}
          onToast={showToast}
        />
      ) : activeTab.kind === 'video' ? (
        <VideoStudio
          tab={activeTab}
          onSendFrameToStudio={handleSendPdfPageToStudio}
          onToast={showToast}
        />
      ) : (
        <ImageStudio
          tab={activeTab}
          onUpdateTab={(updater) =>
            setTabs((prev) =>
              prev.map((t) => (t.id === activeTab.id && t.kind === 'image' ? updater(t) : t))
            )
          }
          onNavigateSibling={handleNavigateSibling}
          onToast={showToast}
        />
      )}

      {showRecordModal && (
        <RecordModal
          onClose={() => setShowRecordModal(false)}
          onStart={startVideoRecording}
        />
      )}

      {showSyncModal && (
        <SyncModal
          onClose={() => setShowSyncModal(false)}
          onToast={showToast}
        />
      )}

      {showMobilePairModal && (
        <MobilePairModal
          onClose={() => setShowMobilePairModal(false)}
          onPaired={() => setShowMobilePairModal(false)}
          onToast={showToast}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          onClose={() => setShowSettingsModal(false)}
          onToast={showToast}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};
