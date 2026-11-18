import React, { useEffect, useState } from 'react';
import { Mic, MicOff, Monitor, Video, X } from 'lucide-react';

export interface CaptureSource {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  isScreen: boolean;
}

interface RecordModalProps {
  onClose: () => void;
  onStart: (sourceId: string, sourceName: string, includeMic: boolean, minimize: boolean) => void;
}

export const RecordModal: React.FC<RecordModalProps> = ({ onClose, onStart }) => {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [includeMic, setIncludeMic] = useState(false);
  const [minimize, setMinimize] = useState(true);

  useEffect(() => {
    window.electronAPI.getCaptureSources().then((list) => {
      setSources(list);
      if (list.length > 0) setSelectedId(list[0].id);
    });
  }, []);

  const selected = sources.find((s) => s.id === selectedId);

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
          maxWidth: 760,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
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
            <Video size={18} color="#ef4444" />
            <strong style={{ fontSize: 15 }}>Bildschirmvideo aufnehmen</strong>
          </div>
          <button className="btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            padding: 16,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
            gap: 12,
          }}
        >
          {sources.map((src) => (
            <div
              key={src.id}
              onClick={() => setSelectedId(src.id)}
              style={{
                borderRadius: 10,
                padding: 8,
                cursor: 'pointer',
                background: 'var(--bg-elevated)',
                border:
                  src.id === selectedId
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
              }}
            >
              <img
                src={src.thumbnailDataUrl}
                alt={src.name}
                style={{
                  width: '100%',
                  height: 112,
                  objectFit: 'cover',
                  borderRadius: 6,
                  background: '#000',
                  display: 'block',
                }}
              />
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={src.name}
              >
                {src.isScreen && <Monitor size={13} color="#3b82f6" />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{src.name}</span>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            padding: '12px 18px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-toolbar)',
          }}
        >
          <button
            className={`btn ${includeMic ? 'active' : ''}`}
            onClick={() => setIncludeMic((m) => !m)}
          >
            {includeMic ? <Mic size={15} /> : <MicOff size={15} />}
            Mikrofon {includeMic ? 'Ein' : 'Aus'}
          </button>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={minimize}
              onChange={(e) => setMinimize(e.target.checked)}
            />
            Fenster beim Start minimieren (Stopp mit Strg+Alt+R)
          </label>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>
              Abbrechen
            </button>
            <button
              className="btn btn-primary"
              disabled={!selected}
              onClick={() =>
                selected && onStart(selected.id, selected.name, includeMic, minimize)
              }
            >
              <Video size={15} /> Aufnahme starten
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
