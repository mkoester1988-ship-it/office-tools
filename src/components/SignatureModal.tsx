import React, { useEffect, useRef, useState } from 'react';
import { Check, PenTool, Trash2, Upload, X } from 'lucide-react';
import type { SavedSignature } from '../types';

interface SignatureModalProps {
  onClose: () => void;
  onSelectForPlacement: (dataUrl: string) => void;
  onToast: (msg: string) => void;
}

const STORAGE_KEY = 'pdfreader_saved_signatures';

function loadSavedSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedSignature[]) : [];
  } catch {
    return [];
  }
}

function saveSignaturesToStorage(list: SavedSignature[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function trimTransparentCanvas(src: HTMLCanvasElement): string {
  const ctx = src.getContext('2d');
  if (!ctx) return src.toDataURL('image/png');
  const { width, height } = src;
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;

  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = d[(y * width + x) * 4 + 3];
      if (alpha > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return src.toDataURL('image/png');
  }
  const pad = 8;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(width - sx, maxX - minX + 1 + pad * 2);
  const sh = Math.min(height - sy, maxY - minY + 1 + pad * 2);

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const oCtx = out.getContext('2d');
  oCtx?.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL('image/png');
}

function processUploadedSignature(
  img: HTMLImageElement,
  strengthPct: number,
  inkColor: 'original' | '#0f172a' | '#1e3a8a' | '#1d4ed8'
): string {
  const maxDim = 900;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Composite onto pure white first so semi-transparent gray paper (e.g. re-edited signatures)
  // reveals its true visual brightness on white paper instead of dark RGB with low alpha.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  if (strengthPct <= 0) {
    return canvas.toDataURL('image/png');
  }

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // 1. Visual luminance array on white
  const lumArr = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const idx = p * 4;
    lumArr[p] = 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
  }

  // 2. Adaptive local paper-background estimation (handles gray paper & uneven shadows)
  const blockSize = Math.max(16, Math.round(Math.min(w, h) / 14));
  const gw = Math.max(1, Math.ceil(w / blockSize));
  const gh = Math.max(1, Math.ceil(h / blockSize));
  let grid = new Float32Array(gw * gh);

  for (let gy = 0; gy < gh; gy++) {
    const y0 = gy * blockSize;
    const y1 = Math.min(h, y0 + blockSize);
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * blockSize;
      const x1 = Math.min(w, x0 + blockSize);
      const samples: number[] = [];
      for (let y = y0; y < y1; y += 2) {
        const row = y * w;
        for (let x = x0; x < x1; x += 2) {
          samples.push(lumArr[row + x]);
        }
      }
      samples.sort((a, b) => a - b);
      // 85th percentile reliably tracks local paper brightness even across dark strokes
      const p85 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.85))];
      grid[gy * gw + gx] = Math.max(95, p85);
    }
  }

  // Smooth the background grid (2 passes of 3x3 box blur) so shadows transition cleanly
  for (let pass = 0; pass < 2; pass++) {
    const nextGrid = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let sum = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = gy + dy;
          if (ny < 0 || ny >= gh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx;
            if (nx < 0 || nx >= gw) continue;
            sum += grid[ny * gw + nx];
            cnt++;
          }
        }
        nextGrid[gy * gw + gx] = sum / Math.max(1, cnt);
      }
    }
    grid = nextGrid;
  }

  let targetR = 15,
    targetG = 23,
    targetB = 42;
  if (inkColor === '#1e3a8a') {
    targetR = 30;
    targetG = 58;
    targetB = 138;
  } else if (inkColor === '#1d4ed8') {
    targetR = 29;
    targetG = 78;
    targetB = 216;
  }

  // 3. Flat-field normalize each pixel against its local paper background and remove paper cleanly
  // strengthPct 1..100 -> cutoff 251 (gentle) down to 137 (very strong)
  const cutoff = Math.max(120, Math.min(252, 252 - strengthPct * 1.15));
  const softBand = 32;

  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) / blockSize - 0.5;
    const gy0 = Math.max(0, Math.min(gh - 1, Math.floor(fy)));
    const gy1 = Math.max(0, Math.min(gh - 1, gy0 + 1));
    const ty = Math.max(0, Math.min(1, fy - gy0));

    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const idx = p * 4;

      const fx = (x + 0.5) / blockSize - 0.5;
      const gx0 = Math.max(0, Math.min(gw - 1, Math.floor(fx)));
      const gx1 = Math.max(0, Math.min(gw - 1, gx0 + 1));
      const tx = Math.max(0, Math.min(1, fx - gx0));

      const b00 = grid[gy0 * gw + gx0];
      const b10 = grid[gy0 * gw + gx1];
      const b01 = grid[gy1 * gw + gx0];
      const b11 = grid[gy1 * gw + gx1];
      const bg =
        b00 * (1 - tx) * (1 - ty) +
        b10 * tx * (1 - ty) +
        b01 * (1 - tx) * ty +
        b11 * tx * ty;

      const lum = lumArr[p];
      const normLum = bg > 15 ? Math.min(255, (lum / bg) * 255) : lum;

      if (normLum >= cutoff) {
        d[idx + 3] = 0;
      } else {
        const strength = Math.min(1, (cutoff - normLum) / softBand);
        // Smoothstep curve for crisp anti-aliased ink edges without gray halo
        const smooth = strength * strength * (3 - 2 * strength);
        d[idx + 3] = Math.round(255 * smooth);
        if (inkColor !== 'original') {
          d[idx] = targetR;
          d[idx + 1] = targetG;
          d[idx + 2] = targetB;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return trimTransparentCanvas(canvas);
}

export const SignatureModal: React.FC<SignatureModalProps> = ({
  onClose,
  onSelectForPlacement,
  onToast,
}) => {
  const [saved, setSaved] = useState<SavedSignature[]>(() => loadSavedSignatures());
  const [editingSigId, setEditingSigId] = useState<string | null>(null);
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [drawColor, setDrawColor] = useState<'#0f172a' | '#1e3a8a' | '#1d4ed8'>('#0f172a');
  const [isDrawing, setIsDrawing] = useState(false);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [rawImg, setRawImg] = useState<HTMLImageElement | null>(null);
  const [threshold, setThreshold] = useState(55);
  const [inkColor, setInkColor] = useState<'original' | '#0f172a' | '#1e3a8a' | '#1d4ed8'>('#0f172a');
  const [processedPreview, setProcessedPreview] = useState<string>('');
  const [sigName, setSigName] = useState('Meine Unterschrift');

  // Auto-clean legacy saved signatures (from v1.6.0/v1.6.1) that still had gray paper background
  useEffect(() => {
    const needsClean = saved.some((s) => !s.cleanedV2);
    if (!needsClean) return;
    let cancelled = false;
    Promise.all(
      saved.map(
        (sig) =>
          new Promise<SavedSignature>((resolve) => {
            if (sig.cleanedV2) {
              resolve(sig);
              return;
            }
            const img = new Image();
            img.onload = () => {
              const cleanedUrl = processUploadedSignature(img, 55, 'original');
              resolve({ ...sig, dataUrl: cleanedUrl || sig.dataUrl, cleanedV2: true });
            };
            img.onerror = () => resolve({ ...sig, cleanedV2: true });
            img.src = sig.dataUrl;
          })
      )
    ).then((upgraded) => {
      if (cancelled) return;
      setSaved(upgraded);
      saveSignaturesToStorage(upgraded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!rawImg) return;
    setProcessedPreview(processUploadedSignature(rawImg, threshold, inkColor));
  }, [rawImg, threshold, inkColor]);

  const clearDrawCanvas = () => {
    const c = drawCanvasRef.current;
    if (!c) return;
    c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  };

  const getDrawCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = drawCanvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const handleSaveAndUse = (dataUrl: string) => {
    if (!dataUrl) return;
    const entry: SavedSignature = {
      id: editingSigId ?? `sig_${Date.now()}`,
      name: sigName.trim() || 'Unterschrift',
      dataUrl,
      cleanedV2: true,
    };
    const next = editingSigId
      ? saved.map((s) => (s.id === editingSigId ? entry : s))
      : [entry, ...saved];
    setSaved(next);
    setEditingSigId(null);
    saveSignaturesToStorage(next);
    onToast('Unterschrift gespeichert! Klicke jetzt auf die PDF-Seite.');
    onSelectForPlacement(dataUrl);
  };

  const handleUploadPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const img = new Image();
      img.onload = () => setRawImg(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const checkerboardBg =
    'repeating-conic-gradient(#cbd5e1 0% 25%, #f8fafc 0% 50%) 50% / 14px 14px';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-strong)',
          borderRadius: 14,
          width: '100%',
          maxWidth: 620,
          maxHeight: '90vh',
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
            <PenTool size={18} color="#3b82f6" />
            <strong style={{ fontSize: 15 }}>Unterschrift & Signatur-Studio</strong>
          </div>
          <button className="btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {saved.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <strong style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Gespeicherte Unterschriften (1 Klick zum Platzieren):
              </strong>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {saved.map((sig) => (
                  <div
                    key={sig.id}
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 10,
                      padding: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      width: 170,
                    }}
                  >
                    <div
                      style={{
                        background: checkerboardBg,
                        borderRadius: 6,
                        height: 60,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 4,
                      }}
                    >
                      <img
                        src={sig.dataUrl}
                        alt={sig.name}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      <button
                        className="btn btn-primary"
                        style={{ flex: 1, padding: '4px 6px', fontSize: 11.5, justifyContent: 'center' }}
                        onClick={() => onSelectForPlacement(sig.dataUrl)}
                      >
                        <Check size={12} /> Auf PDF setzen
                      </button>
                      <button
                        className="btn"
                        style={{ padding: '4px 6px', fontSize: 11.5 }}
                        onClick={() => {
                          const img = new Image();
                          img.onload = () => {
                            setEditingSigId(sig.id);
                            setRawImg(img);
                            setSigName(sig.name);
                            setMode('upload');
                          };
                          img.src = sig.dataUrl;
                        }}
                        title="Papier-Hintergrund nachbearbeiten / entfernen"
                      >
                        ✨
                      </button>
                      <button
                        className="btn btn-danger-ghost"
                        style={{ padding: 4 }}
                        onClick={() => {
                          const next = saved.filter((s) => s.id !== sig.id);
                          setSaved(next);
                          saveSignaturesToStorage(next);
                        }}
                        title="Unterschrift löschen"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mode Tabs */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn ${mode === 'draw' ? 'btn-primary' : ''}`}
              onClick={() => setMode('draw')}
            >
              <PenTool size={14} /> Zeichnen
            </button>
            <button
              className={`btn ${mode === 'upload' ? 'btn-primary' : ''}`}
              onClick={() => setMode('upload')}
            >
              <Upload size={14} /> PNG / JPG hochladen & Papier entfernen
            </button>
          </div>

          {mode === 'draw' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5 }}>Tintenfarbe:</span>
                {(
                  [
                    ['#0f172a', 'Schwarz'],
                    ['#1e3a8a', 'Dunkelblau'],
                    ['#1d4ed8', 'Kugelschreiber'],
                  ] as const
                ).map(([col, label]) => (
                  <button
                    key={col}
                    className={`btn ${drawColor === col ? 'active' : ''}`}
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => setDrawColor(col)}
                  >
                    {label}
                  </button>
                ))}
                <button className="btn" style={{ marginLeft: 'auto' }} onClick={clearDrawCanvas}>
                  Leeren
                </button>
              </div>

              <canvas
                ref={drawCanvasRef}
                width={560}
                height={180}
                style={{
                  width: '100%',
                  height: 170,
                  background: '#ffffff',
                  borderRadius: 10,
                  border: '2px dashed var(--border-strong)',
                  touchAction: 'none',
                  cursor: 'crosshair',
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setIsDrawing(true);
                  const ctx = drawCanvasRef.current?.getContext('2d');
                  if (!ctx) return;
                  const pt = getDrawCoords(e);
                  ctx.strokeStyle = drawColor;
                  ctx.lineWidth = 3.5;
                  ctx.lineCap = 'round';
                  ctx.lineJoin = 'round';
                  ctx.beginPath();
                  ctx.moveTo(pt.x, pt.y);
                }}
                onPointerMove={(e) => {
                  if (!isDrawing) return;
                  const ctx = drawCanvasRef.current?.getContext('2d');
                  if (!ctx) return;
                  const pt = getDrawCoords(e);
                  ctx.lineTo(pt.x, pt.y);
                  ctx.stroke();
                }}
                onPointerUp={() => setIsDrawing(false)}
              />

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input-compact"
                  style={{ flex: 1 }}
                  value={sigName}
                  onChange={(e) => setSigName(e.target.value)}
                  placeholder="Name der Unterschrift"
                />
                <button
                  className="btn btn-success"
                  onClick={() => {
                    if (!drawCanvasRef.current) return;
                    handleSaveAndUse(trimTransparentCanvas(drawCanvasRef.current));
                  }}
                >
                  Speichern & Auf PDF setzen
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="btn btn-primary" style={{ justifyContent: 'center', cursor: 'pointer' }}>
                <Upload size={15} /> Unterschrift-Bild (PNG / JPG) auswählen
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleUploadPick}
                />
              </label>

              {rawImg && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                      <span>Papier-Hintergrund entfernen (Stärke):</span>
                      <strong>{threshold} %</strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5 }}>Farbe anpassen:</span>
                    {(
                      [
                        ['original', 'Original'],
                        ['#0f172a', 'Schwarz'],
                        ['#1e3a8a', 'Dunkelblau'],
                        ['#1d4ed8', 'Blau'],
                      ] as const
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        className={`btn ${inkColor === val ? 'active' : ''}`}
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => setInkColor(val)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div
                    style={{
                      background: checkerboardBg,
                      borderRadius: 10,
                      height: 150,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 10,
                      border: '1px solid var(--border-strong)',
                    }}
                  >
                    {processedPreview && (
                      <img
                        src={processedPreview}
                        alt="Vorschau ohne Hintergrund"
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                      />
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="input-compact"
                      style={{ flex: 1 }}
                      value={sigName}
                      onChange={(e) => setSigName(e.target.value)}
                      placeholder="Name der Unterschrift"
                    />
                    <button
                      className="btn btn-success"
                      disabled={!processedPreview}
                      onClick={() => handleSaveAndUse(processedPreview)}
                    >
                      Speichern & Auf PDF setzen
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
