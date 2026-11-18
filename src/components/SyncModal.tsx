import React, { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Smartphone, X } from 'lucide-react';
import type { SyncStatus } from '../types';

interface SyncModalProps {
  onClose: () => void;
  onToast: (msg: string) => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({ onClose, onToast }) => {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    window.electronAPI.getSyncStatus().then(setStatus);
  }, []);

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
        padding: 24,
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-strong)',
          borderRadius: 14,
          width: '100%',
          maxWidth: 520,
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
            <Smartphone size={18} color="#3b82f6" />
            <strong style={{ fontSize: 15 }}>Handy-Sync per QR-Code (ohne Anmeldung)</strong>
          </div>
          <button className="btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {status ? (
            <>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <img
                  src={status.qrDataUrl}
                  alt="Handy-Sync QR-Code"
                  style={{
                    width: 170,
                    height: 170,
                    borderRadius: 10,
                    background: '#fff',
                    padding: 6,
                    flexShrink: 0,
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                  <strong>So verbindest du dein Handy:</strong>
                  <span style={{ color: 'var(--text-muted)' }}>
                    1. Handy & PC müssen im selben WLAN sein.
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    2. QR-Code mit der Handy-Kamera scannen (öffnet direkt ohne Login).
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    3. PDFs/Fotos vom Handy senden oder PC-Dateien aufs Handy laden.
                  </span>
                  <code
                    style={{
                      fontSize: 11,
                      background: 'var(--bg-app)',
                      padding: '4px 8px',
                      borderRadius: 6,
                      wordBreak: 'break-all',
                    }}
                  >
                    {status.url}
                  </code>
                </div>
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
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>Zielordner auf dem PC:</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="input-compact"
                    style={{ flex: 1 }}
                    readOnly
                    value={status.config.targetDir}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      const next = await window.electronAPI.chooseSyncDir();
                      if (next) {
                        setStatus(next);
                        onToast(`Sync-Zielordner geändert: ${next.config.targetDir}`);
                      }
                    }}
                  >
                    <FolderOpen size={14} /> Ordner wählen
                  </button>
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={status.config.autoOpenOnReceive}
                    onChange={async (e) => {
                      const next = await window.electronAPI.setSyncAutoOpen(e.target.checked);
                      if (next) setStatus(next);
                    }}
                  />
                  Empfangene Dateien direkt in PDF-Reader Studio öffnen
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  className="btn"
                  onClick={async () => {
                    const next = await window.electronAPI.regenerateSyncToken();
                    if (next) {
                      setStatus(next);
                      onToast('Neuer QR-Code / Pairing-Schlüssel erzeugt.');
                    }
                  }}
                >
                  <RefreshCw size={14} /> QR-Code erneuern
                </button>
                <button className="btn btn-primary" onClick={onClose}>
                  Fertig
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Starte Sync-Dienst...</div>
          )}
        </div>
      </div>
    </div>
  );
};
