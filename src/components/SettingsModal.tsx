import React, { useEffect, useState } from 'react';
import { Settings, X } from 'lucide-react';
import type { AppSettings } from '../types';

interface SettingsModalProps {
  onClose: () => void;
  onToast: (msg: string) => void;
}

function keyEventToAccelerator(e: React.KeyboardEvent<HTMLInputElement>): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (key === 'ArrowUp') key = 'Up';
  else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left';
  else if (key === 'ArrowRight') key = 'Right';

  parts.push(key);
  return parts.join('+');
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onToast }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings);
  }, []);

  const savePatch = async (patch: Partial<AppSettings>) => {
    const res = await window.electronAPI.updateSettings(patch);
    setSettings(res.settings);
    if (res.shortcutError) {
      onToast(res.shortcutError);
    } else {
      onToast('Einstellungen gespeichert.');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-strong)',
          borderRadius: 14,
          width: '100%',
          maxWidth: 500,
          boxShadow: 'var(--shadow)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={18} color="#3b82f6" />
            <strong style={{ fontSize: 15 }}>Einstellungen & Tastenkürzel</strong>
          </div>
          <button className="btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {settings ? (
            <>
              <div
                style={{
                  background: 'var(--bg-elevated)',
                  padding: 12,
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <strong style={{ fontSize: 13 }}>Fenster & Hintergrunddienst</strong>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.minimizeToTray}
                    onChange={(e) => savePatch({ minimizeToTray: e.target.checked })}
                  />
                  Beim Schließen (X) im System-Tray im Hintergrund weiterlaufen
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.startWithWindows}
                    onChange={(e) => savePatch({ startWithWindows: e.target.checked })}
                  />
                  Mit Windows automatisch im Hintergrund starten
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.autoOpenClipboardScreenshots}
                    onChange={(e) => savePatch({ autoOpenClipboardScreenshots: e.target.checked })}
                  />
                  Windows-Screenshots (Druck / Win+Shift+S) automatisch übernehmen
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.bringToFrontOnCapture}
                    onChange={(e) => savePatch({ bringToFrontOnCapture: e.target.checked })}
                  />
                  Fenster bei neuem Screenshot in den Vordergrund holen (aus = bleibt im Hintergrund)
                </label>
              </div>

              <div
                style={{
                  background: 'var(--bg-elevated)',
                  padding: 12,
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <strong style={{ fontSize: 13 }}>
                  Eigene Tastenkürzel (reinklicken & Taste drücken)
                </strong>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13 }}>Screenshot aufnehmen:</span>
                  <input
                    className="input-compact"
                    style={{ width: 210, textAlign: 'center', fontWeight: 600 }}
                    readOnly
                    value={settings.screenshotShortcut}
                    onKeyDown={(e) => {
                      e.preventDefault();
                      const acc = keyEventToAccelerator(e);
                      if (acc) savePatch({ screenshotShortcut: acc });
                    }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13 }}>Bildschirmvideo starten/stoppen:</span>
                  <input
                    className="input-compact"
                    style={{ width: 210, textAlign: 'center', fontWeight: 600 }}
                    readOnly
                    value={settings.videoShortcut}
                    onKeyDown={(e) => {
                      e.preventDefault();
                      const acc = keyEventToAccelerator(e);
                      if (acc) savePatch({ videoShortcut: acc });
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={onClose}>
                  Fertig
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Lade Einstellungen...</div>
          )}
        </div>
      </div>
    </div>
  );
};
